/*
 * Copyright (C) 2014-2019 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#import "config.h"
#import "ProcessAssertion.h"

#if PLATFORM(IOS_FAMILY)

#import "AssertionServicesSPI.h"
#import "Logging.h"
#import "RunningBoardServicesSPI.h"
#import "WebProcessPool.h"
#import <UIKit/UIApplication.h>
#import <wtf/HashMap.h>
#import <wtf/RunLoop.h>
#import <wtf/Vector.h>
#import <wtf/WeakHashSet.h>

using WebKit::ProcessAndUIAssertion;

// This gives some time to our child processes to process the ProcessWillSuspendImminently IPC but makes sure we release
// the background task before the UIKit timeout (We get killed if we do not release the background task within 5 seconds
// on the expiration handler getting called).
static const Seconds releaseBackgroundTaskAfterExpirationDelay { 2_s };

@interface WKProcessAssertionBackgroundTaskManager
#if HAVE(RUNNINGBOARD_WEBKIT_ASSERTIONS)
    : NSObject <RBSAssertionObserving>
#else
    : NSObject
#endif

+ (WKProcessAssertionBackgroundTaskManager *)shared;

- (void)addAssertionNeedingBackgroundTask:(ProcessAndUIAssertion&)assertion;
- (void)removeAssertionNeedingBackgroundTask:(ProcessAndUIAssertion&)assertion;

@end

@implementation WKProcessAssertionBackgroundTaskManager
{
#if HAVE(RUNNINGBOARD_WEBKIT_ASSERTIONS)
    RetainPtr<RBSAssertion> _backgroundTask;
#else
    UIBackgroundTaskIdentifier _backgroundTask;
#endif

    WeakHashSet<ProcessAndUIAssertion> _assertionsNeedingBackgroundTask;
    BOOL _applicationIsBackgrounded;
    dispatch_block_t _pendingTaskReleaseTask;
}

+ (WKProcessAssertionBackgroundTaskManager *)shared
{
    static WKProcessAssertionBackgroundTaskManager *shared = [WKProcessAssertionBackgroundTaskManager new];
    return shared;
}

- (instancetype)init
{
    self = [super init];
    if (!self)
        return nil;

#if !HAVE(RUNNINGBOARD_WEBKIT_ASSERTIONS)
    _backgroundTask = UIBackgroundTaskInvalid;
#endif

    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationWillEnterForegroundNotification object:[UIApplication sharedApplication] queue:nil usingBlock:^(NSNotification *) {
        _applicationIsBackgrounded = NO;
        [self _cancelPendingReleaseTask];
        [self _updateBackgroundTask];
    }];

    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidEnterBackgroundNotification object:[UIApplication sharedApplication] queue:nil usingBlock:^(NSNotification *) {
        _applicationIsBackgrounded = YES;
        
        if (![self _hasBackgroundTask])
            WebKit::WebProcessPool::notifyProcessPoolsApplicationIsAboutToSuspend();
    }];

    return self;
}

- (void)dealloc
{
    [self _releaseBackgroundTask];
    [super dealloc];
}

- (void)addAssertionNeedingBackgroundTask:(ProcessAndUIAssertion&)assertion
{
    _assertionsNeedingBackgroundTask.add(&assertion);
    [self _updateBackgroundTask];
}

- (void)removeAssertionNeedingBackgroundTask:(ProcessAndUIAssertion&)assertion
{
    _assertionsNeedingBackgroundTask.remove(assertion);
    [self _updateBackgroundTask];
}

- (void)_notifyAssertionsOfImminentSuspension
{
    ASSERT(RunLoop::isMain());

    Vector<WeakPtr<ProcessAndUIAssertion>> assertionsNeedingBackgroundTask;
    for (auto& assertion : _assertionsNeedingBackgroundTask)
        assertionsNeedingBackgroundTask.append(makeWeakPtr(assertion));

    // Note that we don't expect clients to register new assertions when getting notified that the UI assertion will expire imminently.
    // If clients were to do so, then those new assertions would not get notified of the imminent suspension.
    for (auto assertion : assertionsNeedingBackgroundTask) {
        if (assertion)
            assertion->uiAssertionWillExpireImminently();
    }
}


- (void)_scheduleReleaseTask
{
    ASSERT(!_pendingTaskReleaseTask);
    if (_pendingTaskReleaseTask)
        return;

    RELEASE_LOG(ProcessSuspension, "%p - WKProcessAssertionBackgroundTaskManager: _scheduleReleaseTask because the expiration handler has been called", self);
    _pendingTaskReleaseTask = dispatch_block_create((dispatch_block_flags_t)0, ^{
        _pendingTaskReleaseTask = nil;
        [self _releaseBackgroundTask];
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, releaseBackgroundTaskAfterExpirationDelay.value() * NSEC_PER_SEC), dispatch_get_main_queue(), _pendingTaskReleaseTask);
#if !__has_feature(objc_arc)
    // dispatch_async() does a Block_copy() / Block_release() on behalf of the caller.
    Block_release(_pendingTaskReleaseTask);
#endif
}

- (void)_cancelPendingReleaseTask
{
    if (!_pendingTaskReleaseTask)
        return;

    RELEASE_LOG(ProcessSuspension, "%p - WKProcessAssertionBackgroundTaskManager: _cancelPendingReleaseTask because the application is foreground again", self);
    dispatch_block_cancel(_pendingTaskReleaseTask);
    _pendingTaskReleaseTask = nil;
}

- (BOOL)_hasBackgroundTask
{
#if HAVE(RUNNINGBOARD_WEBKIT_ASSERTIONS)
    return !!_backgroundTask;
#else
    return _backgroundTask != UIBackgroundTaskInvalid;
#endif
}

- (void)_updateBackgroundTask
{
    if (!_assertionsNeedingBackgroundTask.computesEmpty() && ![self _hasBackgroundTask]) {
        if (_applicationIsBackgrounded) {
            RELEASE_LOG_ERROR(ProcessSuspension, "%p - WKProcessAssertionBackgroundTaskManager: Ignored request to start a new background task because the application is already in the background", self);
            return;
        }
        RELEASE_LOG(ProcessSuspension, "%p - WKProcessAssertionBackgroundTaskManager: beginBackgroundTaskWithName", self);
#if HAVE(RUNNINGBOARD_WEBKIT_ASSERTIONS)
        RBSTarget *target = [RBSTarget currentProcess];
        RBSDomainAttribute *domainAttribute = [RBSDomainAttribute attributeWithDomain:@"com.apple.common" name:@"FinishTaskInterruptable"];
        _backgroundTask = adoptNS([[RBSAssertion alloc] initWithExplanation:@"WebKit UIProcess background task" target:target attributes:@[domainAttribute]]);
        [_backgroundTask addObserver:self];

        NSError *acquisitionError = nil;
        if (![_backgroundTask acquireWithError:&acquisitionError])
            RELEASE_LOG_ERROR(ProcessSuspension, "WKProcessAssertionBackgroundTaskManager: Failed to acquire FinishTaskInterruptable assertion for own process, error: %{public}@", acquisitionError);
        else
            RELEASE_LOG(ProcessSuspension, "WKProcessAssertionBackgroundTaskManager: Successfully took a FinishTaskInterruptable assertion for own process");
#else
        _backgroundTask = [[UIApplication sharedApplication] beginBackgroundTaskWithName:@"com.apple.WebKit.ProcessAssertion" expirationHandler:^{
            [self _handleBackgroundTaskExpiration];
        }];
#endif
    } else if (_assertionsNeedingBackgroundTask.computesEmpty())
        [self _releaseBackgroundTask];
}

#if HAVE(RUNNINGBOARD_WEBKIT_ASSERTIONS)
- (void)assertionWillInvalidate:(RBSAssertion *)assertion
{
    ASSERT(assertion == _backgroundTask.get());
    [self _handleBackgroundTaskExpiration];
}

- (void)assertion:(RBSAssertion *)assertion didInvalidateWithError:(NSError *)error
{
    ASSERT(assertion == _backgroundTask.get());
    RELEASE_LOG_ERROR(ProcessSuspension, "WKProcessAssertionBackgroundTaskManager: FinishTaskInterruptable assertion was invalidated, error: %{public}@", error);
}
#endif

- (void)_handleBackgroundTaskExpiration
{
    RELEASE_LOG(ProcessSuspension, "WKProcessAssertionBackgroundTaskManager: Background task expired while holding WebKit ProcessAssertion (isMainThread? %d).", RunLoop::isMain());
    if (!_applicationIsBackgrounded) {
        // We've received the invalidation warning after the app has become foreground again. In this case, we should not
        // warn clients of imminent suspension. To be safe (avoid potential killing), we end the task right away and call
        // _updateBackgroundTask asynchronously to start a new task if necessary.
        [self _releaseBackgroundTask];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self _updateBackgroundTask];
        });
        return;
    }

    // The expiration handler gets called on a non-main thread when the underlying assertion could not be taken (rdar://problem/27278419).
    if (RunLoop::isMain())
        [self _notifyAssertionsOfImminentSuspension];
    else {
        dispatch_sync(dispatch_get_main_queue(), ^{
            [self _notifyAssertionsOfImminentSuspension];
        });
    }

    [self _scheduleReleaseTask];
}

- (void)_releaseBackgroundTask
{
    if (![self _hasBackgroundTask])
        return;

    RELEASE_LOG(ProcessSuspension, "%p - WKProcessAssertionBackgroundTaskManager: endBackgroundTask", self);
    if (_applicationIsBackgrounded)
        WebKit::WebProcessPool::notifyProcessPoolsApplicationIsAboutToSuspend();

#if HAVE(RUNNINGBOARD_WEBKIT_ASSERTIONS)
    [_backgroundTask removeObserver:self];
    [_backgroundTask invalidate];
    _backgroundTask = nullptr;
#else
    [[UIApplication sharedApplication] endBackgroundTask:_backgroundTask];
    _backgroundTask = UIBackgroundTaskInvalid;
#endif
}

@end

namespace WebKit {

const BKSProcessAssertionFlags suspendedTabFlags = (BKSProcessAssertionAllowIdleSleep);
const BKSProcessAssertionFlags backgroundTabFlags = (BKSProcessAssertionPreventTaskSuspend);
const BKSProcessAssertionFlags foregroundTabFlags = (BKSProcessAssertionPreventTaskSuspend | BKSProcessAssertionWantsForegroundResourcePriority | BKSProcessAssertionPreventTaskThrottleDown);

static BKSProcessAssertionFlags flagsForAssertionType(ProcessAssertionType assertionType)
{
    switch (assertionType) {
    case ProcessAssertionType::Suspended:
        return suspendedTabFlags;
    case ProcessAssertionType::Background:
    case ProcessAssertionType::UnboundedNetworking:
        return backgroundTabFlags;
    case ProcessAssertionType::Foreground:
    case ProcessAssertionType::MediaPlayback:
        return foregroundTabFlags;
    }
}

static BKSProcessAssertionReason toBKSProcessAssertionReason(ProcessAssertionType assertionType)
{
    switch (assertionType) {
    case ProcessAssertionType::Suspended:
    case ProcessAssertionType::Background:
    case ProcessAssertionType::Foreground:
        return BKSProcessAssertionReasonExtension;
    case ProcessAssertionType::UnboundedNetworking:
        return BKSProcessAssertionReasonFinishTaskUnbounded;
    case ProcessAssertionType::MediaPlayback:
        return BKSProcessAssertionReasonMediaPlayback;
    }
}

ProcessAssertion::ProcessAssertion(pid_t pid, const String& name, ProcessAssertionType assertionType)
    : m_assertionType(assertionType)
{
    auto weakThis = makeWeakPtr(*this);
    BKSProcessAssertionAcquisitionHandler handler = ^(BOOL acquired) {
        if (!acquired) {
            RELEASE_LOG_ERROR(ProcessSuspension, " %p - ProcessAssertion() PID %d Unable to acquire assertion for process with PID %d", this, getpid(), pid);
            dispatch_async(dispatch_get_main_queue(), ^{
                if (weakThis)
                    processAssertionWasInvalidated();
            });
        }
    };
    RELEASE_LOG(ProcessSuspension, "%p - ProcessAssertion() PID %d acquiring assertion for process with PID %d, name '%s'", this, getpid(), pid, name.utf8().data());
    
    m_assertion = adoptNS([[BKSProcessAssertion alloc] initWithPID:pid flags:flagsForAssertionType(assertionType) reason:toBKSProcessAssertionReason(assertionType) name:(NSString *)name withHandler:handler]);
    m_assertion.get().invalidationHandler = ^() {
        dispatch_async(dispatch_get_main_queue(), ^{
            RELEASE_LOG(ProcessSuspension, "%p - ProcessAssertion() Process assertion for process with PID %d was invalidated", this, pid);
            if (weakThis)
                processAssertionWasInvalidated();
        });
    };
}

ProcessAssertion::~ProcessAssertion()
{
    m_assertion.get().invalidationHandler = nil;

    RELEASE_LOG(ProcessSuspension, "%p - ~ProcessAssertion() Releasing process assertion", this);
    [m_assertion invalidate];
}

void ProcessAssertion::processAssertionWasInvalidated()
{
    ASSERT(RunLoop::isMain());
    RELEASE_LOG_ERROR(ProcessSuspension, "%p - ProcessAssertion::processAssertionWasInvalidated()", this);

    m_validity = Validity::No;
}

void ProcessAndUIAssertion::updateRunInBackgroundCount()
{
    bool shouldHoldBackgroundTask = validity() != Validity::No && type() != ProcessAssertionType::Suspended;
    if (m_isHoldingBackgroundTask == shouldHoldBackgroundTask)
        return;

    if (shouldHoldBackgroundTask)
        [[WKProcessAssertionBackgroundTaskManager shared] addAssertionNeedingBackgroundTask:*this];
    else
        [[WKProcessAssertionBackgroundTaskManager shared] removeAssertionNeedingBackgroundTask:*this];

    m_isHoldingBackgroundTask = shouldHoldBackgroundTask;
}

ProcessAndUIAssertion::ProcessAndUIAssertion(pid_t pid, const String& reason, ProcessAssertionType assertionType)
    : ProcessAssertion(pid, reason, assertionType)
{
    updateRunInBackgroundCount();
}

ProcessAndUIAssertion::~ProcessAndUIAssertion()
{
    if (m_isHoldingBackgroundTask)
        [[WKProcessAssertionBackgroundTaskManager shared] removeAssertionNeedingBackgroundTask:*this];
}

void ProcessAndUIAssertion::uiAssertionWillExpireImminently()
{
    if (auto* client = this->client())
        client->uiAssertionWillExpireImminently();
}

void ProcessAndUIAssertion::processAssertionWasInvalidated()
{
    ProcessAssertion::processAssertionWasInvalidated();
    updateRunInBackgroundCount();
}

} // namespace WebKit

#endif // PLATFORM(IOS_FAMILY)
