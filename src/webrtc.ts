import GLib from '@girs/node-glib-2.0';
import GObject from '@girs/node-gobject-2.0';
import Gst from '@girs/node-gst-1.0';
import GstSdp from '@girs/node-gstsdp-1.0';
import GstWebRTC from '@girs/node-gstwebrtc-1.0';

it('WebRTC sendrecv', main);

function gstExecutor(
  promise: Gst.Promise,
  resolve: (value: Gst.Structure) => void,
  reject: (reason: Error) => void,
) {
  const reply = promise.getReply();
  const value: GObject.Value = reply?.getValue('error');
  if (value) {
    using error = Object.assign(value.getBoxed<GLib.Error>(), {
      [Symbol.dispose]: () => error.free(),
    });
    reject(new Error(error.message));
  } else {
    resolve(reply);
  }
}

async function createOffer(webrtc: Gst.Element) {
  const reply = await new Promise<Gst.Structure>((resolve, reject) => {
    webrtc.emit(
      'create-offer',
      Gst.Structure.newEmpty('NULL'),
      Gst.Promise.newWithChangeFunc((x) => gstExecutor(x, resolve, reject)),
    );
  });
  const value: GObject.Value = reply.getValue('offer');
  using description = Object.assign(
    value.getBoxed<GstWebRTC.WebRTCSessionDescription>(),
    { [Symbol.dispose]: () => description.free() },
  );
  console.log(`Created offer:\n${description.sdp.asText()}`);
  return description.sdp.asText();
}

async function createAnswer(webrtc: Gst.Element) {
  const reply = await new Promise<Gst.Structure>((resolve, reject) => {
    webrtc.emit(
      'create-answer',
      Gst.Structure.newEmpty('NULL'),
      Gst.Promise.newWithChangeFunc((x) => gstExecutor(x, resolve, reject)),
    );
  });
  const value: GObject.Value = reply.getValue('answer');
  using description = Object.assign(
    value.getBoxed<GstWebRTC.WebRTCSessionDescription>(),
    { [Symbol.dispose]: () => description.free() },
  );
  console.log(`Created answer:\n${description.sdp.asText()}`);
  return description.sdp.asText();
}

async function setLocalDescription(
  webrtc: Gst.Element,
  type: GstWebRTC.WebRTCSDPType,
  sdpText: string,
) {
  const [, sdpMessage] = GstSdp.SDPMessage.newFromText(sdpText);
  const description = GstWebRTC.WebRTCSessionDescription.new(type, sdpMessage);
  await new Promise<Gst.Structure>((resolve, reject) => {
    webrtc.emit(
      'set-local-description',
      description,
      Gst.Promise.newWithChangeFunc((x) => gstExecutor(x, resolve, reject)),
    );
  });
}

async function setRemoteDescription(
  webrtc: Gst.Element,
  type: GstWebRTC.WebRTCSDPType,
  sdpText: string,
) {
  const [, sdpMessage] = GstSdp.SDPMessage.newFromText(sdpText);
  const description = GstWebRTC.WebRTCSessionDescription.new(type, sdpMessage);
  await new Promise<Gst.Structure>((resolve, reject) => {
    webrtc.emit(
      'set-remote-description',
      description,
      Gst.Promise.newWithChangeFunc((x) => gstExecutor(x, resolve, reject)),
    );
  });
}

async function addIceCandidate(
  webrtc: Gst.Element,
  candidateInit: RTCIceCandidateInit,
) {
  await new Promise<Gst.Structure>((resolve, reject) => {
    webrtc.emit(
      'add-ice-candidate',
      candidateInit.sdpMLineIndex,
      candidateInit.candidate,
      Gst.Promise.newWithChangeFunc((x) => gstExecutor(x, resolve, reject)),
    );
  });
}

async function main() {
  Gst.init(null);

  using pipeline = Object.assign(
    Gst.parseLaunch(`
      videotestsrc ! video/x-raw,framerate=1/1 ! queue ! vp8enc ! rtpvp8pay ! queue !
      application/x-rtp,media=video,payload=96,encoding-name=VP8 !
      webrtcbin name=send webrtcbin name=recv
    `) as Gst.Pipeline,
    { [Symbol.dispose]: () => pipeline.unref() },
  );

  using bus = Object.assign(pipeline.getBus(), {
    [Symbol.dispose]: () => {
      bus.removeWatch();
      bus.unref();
    },
  });

  bus.addWatch(GLib.PRIORITY_DEFAULT, (bus, msg): boolean => {
    switch (msg.type) {
      case Gst.MessageType.STATE_CHANGED:
        if (msg.src === pipeline) {
          const [oldState, newState] = msg.parseStateChanged();
          const oldStateName = Gst.Element.stateGetName(oldState);
          const newStateName = Gst.Element.stateGetName(newState);
          const dumpName = `state_changed-${oldStateName}_${newStateName}`;
          Gst.debugBinToDotFileWithTs(
            pipeline,
            Gst.DebugGraphDetails.ALL,
            dumpName,
          );
        }
        break;
      case Gst.MessageType.ERROR:
        Gst.debugBinToDotFileWithTs(
          pipeline,
          Gst.DebugGraphDetails.ALL,
          'error',
        );

        const [err, dbgInfo] = msg.parseError();
        console.error(
          `ERROR from element ${msg.src.getName()}: ${err.message}`,
        );
        console.error(`Debugging info: ${dbgInfo || 'none'}`);
        err.free();
        break;
      case Gst.MessageType.EOS:
        Gst.debugBinToDotFileWithTs(pipeline, Gst.DebugGraphDetails.ALL, 'eos');
        console.log('End-Of-Stream reached.');
        break;
      default:
        break;
    }

    return true;
  });

  using webrtc1 = Object.assign(pipeline.getByName('send'), {
    [Symbol.dispose]: () => webrtc1.unref(),
  });
  using webrtc2 = Object.assign(pipeline.getByName('recv'), {
    [Symbol.dispose]: () => webrtc2.unref(),
  });

  webrtc1.connect('on-negotiation-needed', async () => {
    try {
      const offerText = await createOffer(webrtc1);
      await setLocalDescription(
        webrtc1,
        GstWebRTC.WebRTCSDPType.OFFER,
        offerText,
      );
      await setRemoteDescription(
        webrtc2,
        GstWebRTC.WebRTCSDPType.OFFER,
        offerText,
      );
      const answerText = await createAnswer(webrtc2);
      await setLocalDescription(
        webrtc2,
        GstWebRTC.WebRTCSDPType.ANSWER,
        answerText,
      );
      await setRemoteDescription(
        webrtc1,
        GstWebRTC.WebRTCSDPType.ANSWER,
        answerText,
      );
    } catch (error) {
      console.error(error);
    }
  });

  webrtc2.connect('pad-added', (pad: Gst.Pad) => {
    using newPad = Object.assign(pad, {
      [Symbol.dispose]: () => newPad.unref(),
    });

    if (newPad.getDirection() != Gst.PadDirection.SRC) {
      return;
    }

    using outBin = Object.assign(
      Gst.parseBinFromDescription(
        'rtpvp8depay ! vp8dec ! videoconvert ! queue ! xvimagesink sync=false',
        true,
      ),
      { [Symbol.dispose]: () => outBin.unref() },
    );

    pipeline.add(outBin);
    outBin.syncStateWithParent();

    using staticPad = Object.assign(outBin.getStaticPad('sink'), {
      [Symbol.dispose]: () => staticPad.unref(),
    });
    newPad.link(staticPad);
  });

  webrtc1.connect(
    'on-ice-candidate',
    async (sdpMLineIndex: number, candidate: string) => {
      try {
        await addIceCandidate(webrtc2, { sdpMLineIndex, candidate });
      } catch (error) {
        console.error(error);
      }
    },
  );

  webrtc2.connect(
    'on-ice-candidate',
    async (sdpMLineIndex: number, candidate: string) => {
      try {
        await addIceCandidate(webrtc1, { sdpMLineIndex, candidate });
      } catch (error) {
        console.error(error);
      }
    },
  );

  console.log('Starting pipeline');
  pipeline.setState(Gst.State.PLAYING);

  await new Promise((resolve) => setTimeout(resolve, 10000));

  pipeline.setState(Gst.State.NULL);
  console.log('Pipeline stopped');

  Gst.deinit();
}
