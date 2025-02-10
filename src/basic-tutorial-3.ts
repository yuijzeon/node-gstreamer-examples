import Gst from '@girs/node-gst-1.0';

/* Structure to contain all our information, so we can pass it to callbacks */
type CustomData = {
  source?: Gst.Element;
  convert?: Gst.Element;
  resample?: Gst.Element;
  sink?: Gst.Element;
  pipeline?: Gst.Pipeline;
};

it('Dynamic pipelines', async () => {
  const data: CustomData = {};
  let terminate = false;

  /* Initialize GStreamer */
  Gst.init(null);

  /* Create the elements */
  data.source = Gst.ElementFactory.make('uridecodebin', 'source');
  data.convert = Gst.ElementFactory.make('audioconvert', 'convert');
  data.resample = Gst.ElementFactory.make('audioresample', 'resample');
  data.sink = Gst.ElementFactory.make('autoaudiosink', 'sink');

  /* Create the empty pipeline */
  data.pipeline = Gst.Pipeline.new('test-pipeline');

  if (
    !data.source ||
    !data.convert ||
    !data.resample ||
    !data.sink ||
    !data.pipeline
  ) {
    console.error('Not all elements could be created.');
    return;
  }

  /* Build the pipeline. Note that we are NOT linking the source at this point. We will do it later. */
  data.pipeline.add(data.source);
  data.pipeline.add(data.convert);
  data.pipeline.add(data.resample);
  data.pipeline.add(data.sink);
  if (!data.convert.link(data.resample) || !data.resample.link(data.sink)) {
    console.error('Elements could not be linked.');
    data.pipeline.unref();
    return;
  }

  /* Set the URI to play */
  data.source['uri'] =
    'https://gstreamer.freedesktop.org/data/media/sintel_trailer-480p.webm';

  /* Connect to the pad-added signal */
  data.source.connect('pad-added', (pad: Gst.Pad) => {
    padAddedHandler(data.source, pad, data);
  });

  /* Start playing */
  const ret = data.pipeline.setState(Gst.State.PLAYING);
  if (ret === Gst.StateChangeReturn.FAILURE) {
    console.error('Unable to set the pipeline to the playing state.');
    data.pipeline.unref();
    throw new Error();
  }

  /* Listen to the bus */
  const bus = data.pipeline.getBus();
  do {
    const msg = bus.timedPopFiltered(
      Gst.CLOCK_TIME_NONE,
      Gst.MessageType.STATE_CHANGED |
        Gst.MessageType.ERROR |
        Gst.MessageType.EOS,
    );

    /* Parse message */
    if (msg) {
      switch (msg.type) {
        case Gst.MessageType.ERROR:
          const [err, debugInfo] = msg.parseError();
          console.error(
            `Error received from element ${msg.src.name}: ${err.message}`,
          );
          console.error(`Debugging information: ${debugInfo || 'none'}`);
          err.free();
          terminate = true;
          break;
        case Gst.MessageType.EOS:
          console.log('End-Of-Stream reached.');
          terminate = true;
          break;
        case Gst.MessageType.STATE_CHANGED:
          /* We are only interested in state-changed messages from the pipeline */
          if (msg.src === data.pipeline) {
            const [oldState, newState, pendingState] = msg.parseStateChanged();
            const oldStateName = Gst.Element.stateGetName(oldState);
            const newStateName = Gst.Element.stateGetName(newState);
            console.log(
              `Pipeline state changed from ${oldStateName} to ${newStateName}:`,
            );
          }
          break;
        default:
          /* We should not reach here */
          console.error('Unexpected message received.');
          break;
      }
    }
  } while (!terminate);

  /* Free resources */
  bus.unref();
  data.pipeline.setState(Gst.State.NULL);
  data.pipeline.unref();
});

function padAddedHandler(src: Gst.Element, newPad: Gst.Pad, data: CustomData) {
  const sinkPad = data.convert.getStaticPad('sink');

  do {
    console.log(`Received new pad '${src.name}' from '${data.source.name}':`);

    /* If our converter is already linked, we have nothing to do here */
    if (sinkPad.isLinked()) {
      console.log('We are already linked. Ignoring.');
      break;
    }

    /* Check the new pad's type */
    const newPadCaps = newPad.getCurrentCaps();
    const newPadStruct = newPadCaps.getStructure(0);
    const newPadType = newPadStruct.getName();
    if (!newPadType.startsWith('audio/x-raw')) {
      console.log(
        `It has type '${newPadType}' which is not raw audio. Ignoring.`,
      );
      break;
    }

    /* Attempt the link */
    const ret = newPad.link(sinkPad);
    if (ret !== Gst.PadLinkReturn.OK) {
      console.error(`Type is '${newPadType}' but link failed.`);
    } else {
      console.log(`Link succeeded (type '${newPadType}').`);
    }
  } while (false);

  /* Unreference the sink pad */
  sinkPad.unref();
}
