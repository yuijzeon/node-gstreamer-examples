import Gst from '@girs/node-gst-1.0';

it('GStreamer concepts', async () => {
  /* Initialize GStreamer */
  Gst.init(null);

  /* Create the elements */
  const source = Gst.ElementFactory.make('videotestsrc', 'source');
  const sink = Gst.ElementFactory.make('autovideosink', 'sink');

  /* Create the empty pipeline */
  const pipeline = Gst.Pipeline.new(null);

  if (!source || !sink || !pipeline) {
    console.error('Not all elements could be created.');
    throw new Error();
  }

  /* Build the pipeline */
  pipeline.add(source);
  pipeline.add(sink);
  if (!source.link(sink)) {
    console.error('Elements could not be linked.');
    pipeline.unref();
    throw new Error();
  }

  /* Modify the source's properties */
  source.setProperty('pattern', 0);

  /* Start playing */
  const ret = pipeline.setState(Gst.State.PLAYING);
  if (ret === Gst.StateChangeReturn.FAILURE) {
    console.error('Unable to set the pipeline to the playing state.');
    pipeline.unref();
    throw new Error();
  }

  /* Wait until error or EOS */
  const bus = pipeline.getBus();
  const msg = bus.timedPopFiltered(
    Gst.CLOCK_TIME_NONE,
    Gst.MessageType.ERROR | Gst.MessageType.EOS,
  );

  /* Parse message */
  if (msg) {
    switch (msg.type) {
      case Gst.MessageType.ERROR:
        const [err, debugInfo] = msg.parseError();
        console.error(
          `Error received from element ${msg.src.getName()}: ${err.message}`,
        );
        console.error(`Debugging information: ${debugInfo || 'none'}`);
        err.free();
        break;
      case Gst.MessageType.EOS:
        console.log('End-Of-Stream reached.');
        break;
      default:
        /* We should not reach here because we only asked for ERRORs and EOS */
        console.log('Unexpected message received.');
        break;
    }
  }

  /* Free resources */
  bus.unref();
  pipeline.setState(Gst.State.NULL);
  pipeline.unref();
});
