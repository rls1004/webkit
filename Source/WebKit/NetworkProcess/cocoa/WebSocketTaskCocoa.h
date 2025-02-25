/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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

#if HAVE(NSURLSESSION_WEBSOCKET)

#include <wtf/RetainPtr.h>
#include <wtf/WeakPtr.h>

OBJC_CLASS NSURLSessionWebSocketTask;

namespace IPC {
class DataReference;
}

namespace WebKit {
class NetworkSession;
class NetworkSessionCocoa;
class NetworkSocketChannel;

class WebSocketTask : public CanMakeWeakPtr<WebSocketTask> {
    WTF_MAKE_FAST_ALLOCATED;
public:
    WebSocketTask(NetworkSocketChannel&, RetainPtr<NSURLSessionWebSocketTask>&&);
    ~WebSocketTask();

    void sendString(const String&, CompletionHandler<void()>&&);
    void sendData(const IPC::DataReference&, CompletionHandler<void()>&&);
    void close(int32_t code, const String& reason);

    void didConnect(const String&);
    void didClose(unsigned short code, const String& reason);

    void cancel();
    void resume();

    typedef uint64_t TaskIdentifier;
    TaskIdentifier identifier() const;

    NetworkSessionCocoa* networkSession();

private:
    void readNextMessage();

    NetworkSocketChannel& m_channel;
    RetainPtr<NSURLSessionWebSocketTask> m_task;
    bool m_receivedDidClose { false };
    bool m_receivedDidConnect { false };
};

} // namespace WebKit

#endif
