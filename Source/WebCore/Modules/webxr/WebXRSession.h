/*
 * Copyright (C) 2020 Igalia S.L. All rights reserved.
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

#pragma once

#if ENABLE(WEBXR)

#include "ActiveDOMObject.h"
#include "EventTarget.h"
#include "JSDOMPromiseDeferred.h"
#include "WebXRInputSourceArray.h"
#include "WebXRRenderState.h"
#include "WebXRSpace.h"
#include "XREnvironmentBlendMode.h"
#include "XRReferenceSpaceType.h"
#include "XRVisibilityState.h"
#include <wtf/Ref.h>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/Vector.h>

namespace WebCore {

class XRFrameRequestCallback;
class WebXRReferenceSpace;
struct XRRenderStateInit;

class WebXRSession final : public RefCounted<WebXRSession>, public EventTargetWithInlineData, public ActiveDOMObject {
    WTF_MAKE_ISO_ALLOCATED(WebXRSession);
public:
    using RequestReferenceSpacePromise = DOMPromiseDeferred<IDLInterface<WebXRReferenceSpace>>;
    using EndPromise = DOMPromiseDeferred<void>;

    virtual ~WebXRSession();

    using RefCounted<WebXRSession>::ref;
    using RefCounted<WebXRSession>::deref;

    XREnvironmentBlendMode environmentBlendMode() const;
    XRVisibilityState visibilityState() const;
    const WebXRRenderState& renderState() const;
    const WebXRInputSourceArray& inputSources() const;

    void updateRenderState(const XRRenderStateInit&);
    void requestReferenceSpace(const XRReferenceSpaceType&, RequestReferenceSpacePromise&&);

    int requestAnimationFrame(Ref<XRFrameRequestCallback>&&);
    void cancelAnimationFrame(int handle);

    void end(EndPromise&&);

    bool ended() const { return m_ended; }

protected:
    // EventTarget
    EventTargetInterface eventTargetInterface() const override { return WebXRSessionEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const override { return ActiveDOMObject::scriptExecutionContext(); }
    void refEventTarget() override { ref(); }
    void derefEventTarget() override { deref(); }

    // ActiveDOMObject
    const char* activeDOMObjectName() const override;
    void stop() override;

    XREnvironmentBlendMode m_environmentBlendMode;
    XRVisibilityState m_visibilityState;
    RefPtr<WebXRRenderState> m_renderState;
    RefPtr<WebXRInputSourceArray> m_inputSources;
    bool m_ended { false };
};

} // namespace WebCore

#endif // ENABLE(WEBXR)
