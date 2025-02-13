import GLib from '@girs/node-glib-2.0';
import GObject from '@girs/node-gobject-2.0';
import Gst from '@girs/node-gst-1.0';
import GstSdp from '@girs/node-gstsdp-1.0';
import GstWebRTC from '@girs/node-gstwebrtc-1.0';

/** @see {@link https://gitlab.freedesktop.org/gstreamer/gst-plugins-bad/-/blob/discontinued-for-monorepo/tests/examples/webrtc/webrtc.c} */
it('WebRTC sendrecv', async () => {
  Gst.init(null);

  const pipeline = Gst.parseLaunch(`
    videotestsrc ! video/x-raw,framerate=1/1 ! queue ! vp8enc ! rtpvp8pay ! queue !
    application/x-rtp,media=video,payload=96,encoding-name=VP8 !
    webrtcbin name=send webrtcbin name=recv
  `) as Gst.Pipeline;

  const bus = pipeline.getBus();

  bus.addWatch(
    GLib.PRIORITY_DEFAULT,
    (bus: Gst.Bus, msg: Gst.Message): boolean => {
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
          Gst.debugBinToDotFileWithTs(
            pipeline,
            Gst.DebugGraphDetails.ALL,
            'eos',
          );
          console.log('End-Of-Stream reached.');
          break;
        default:
          break;
      }

      return true;
    },
  );

  const webrtc1 = pipeline.getByName('send');
  const webrtc2 = pipeline.getByName('recv');

  webrtc1.connect('on-negotiation-needed', async () => {
    const offerPromise = await new Promise<Gst.Promise>((resolve) => {
      webrtc1.emit(
        'create-offer',
        Gst.Structure.newEmpty('NULL'),
        Gst.Promise.newWithChangeFunc((x) => resolve(x)),
      );
    });

    const offerReply = offerPromise.getReply();
    const offerValue: GObject.Value = offerReply.getValue('offer');
    const offer1 = offerValue.getBoxed<GstWebRTC.WebRTCSessionDescription>();
    const offerText = offer1.sdp.asText();
    console.log(`Created offer:\n${offerText}`);
    await new Promise<void>((resolve) => {
      webrtc1.emit(
        'set-local-description',
        offer1,
        Gst.Promise.newWithChangeFunc(() => resolve()),
      );
    });
    offer1.free();

    const [, offerSdp] = GstSdp.SDPMessage.newFromText(offerText);
    const offer2 = GstWebRTC.WebRTCSessionDescription.new(
      GstWebRTC.WebRTCSDPType.OFFER,
      offerSdp,
    );
    await new Promise<void>((resolve) => {
      webrtc2.emit(
        'set-remote-description',
        offer2,
        Gst.Promise.newWithChangeFunc(() => resolve()),
      );
    });
    offer2.free();

    const answerPromise = await new Promise<Gst.Promise>((resolve) => {
      webrtc2.emit(
        'create-answer',
        Gst.Structure.newEmpty('NULL'),
        Gst.Promise.newWithChangeFunc((x) => resolve(x)),
      );
    });

    const answerReply = answerPromise.getReply();
    const answerValue: GObject.Value = answerReply.getValue('answer');
    const answer2 = answerValue.getBoxed<GstWebRTC.WebRTCSessionDescription>();
    const answer = answer2.sdp.asText();
    console.log(`Created answer:\n${answer}`);

    await new Promise<void>((resolve) => {
      webrtc2.emit(
        'set-local-description',
        answer2,
        Gst.Promise.newWithChangeFunc(() => resolve()),
      );
    });
    answer2.free();

    const [, answerSdp] = GstSdp.SDPMessage.newFromText(answer);
    const answer1 = GstWebRTC.WebRTCSessionDescription.new(
      GstWebRTC.WebRTCSDPType.ANSWER,
      answerSdp,
    );
    await new Promise<void>((resolve) => {
      webrtc1.emit(
        'set-remote-description',
        answer1,
        Gst.Promise.newWithChangeFunc(() => resolve()),
      );
    });
    answer1.free();
  });

  webrtc2.connect('pad-added', (newPad: Gst.Pad) => {
    if (newPad.getDirection() != Gst.PadDirection.SRC) {
      return;
    }

    const outBin = Gst.parseBinFromDescription(
      'rtpvp8depay ! vp8dec ! videoconvert ! queue ! xvimagesink sync=false',
      true,
    );

    pipeline.add(outBin);
    outBin.syncStateWithParent();

    const staticPad = outBin.getStaticPad('sink');
    newPad.link(staticPad);

    staticPad.unref();
    outBin.unref();
    newPad.unref();
  });

  webrtc1.connect(
    'on-ice-candidate',
    async (sdpMLineIndex: number, candidate: string) => {
      await new Promise<void>((resolve) => {
        webrtc2.emit(
          'add-ice-candidate',
          sdpMLineIndex,
          candidate,
          Gst.Promise.newWithChangeFunc(() => resolve()),
        );
      });
    },
  );

  webrtc2.connect(
    'on-ice-candidate',
    async (sdpMLineIndex: number, candidate: string) => {
      await new Promise<void>((resolve) => {
        webrtc1.emit(
          'add-ice-candidate',
          sdpMLineIndex,
          candidate,
          Gst.Promise.newWithChangeFunc(() => resolve()),
        );
      });
    },
  );

  console.log('Starting pipeline');
  pipeline.setState(Gst.State.PLAYING);

  await new Promise((resolve) => setTimeout(resolve, 10000));

  pipeline.setState(Gst.State.NULL);
  console.log('Pipeline stopped');

  webrtc2.unref();
  webrtc1.unref();
  bus.removeWatch();
  bus.unref();
  pipeline.unref();
  Gst.deinit();
});
