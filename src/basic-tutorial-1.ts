import Gst from '@girs/node-gst-1.0';

it('Hello world!', async () => {
  /* Initialize GStreamer */
  Gst.init(null);

  /* Build the pipeline */
  const pipeline = Gst.parseLaunch(
    'playbin uri=https://www.freedesktop.org/software/gstreamer-sdk/data/media/sintel_trailer-480p.webm',
  );

  /* Start playing */
  pipeline.setState(Gst.State.PLAYING);

  /* Wait until error or EOS */
  const bus = pipeline.getBus();
  const msg = bus.timedPopFiltered(
    Gst.CLOCK_TIME_NONE,
    Gst.MessageType.ERROR | Gst.MessageType.EOS,
  );

  /* See next tutorial for proper error message handling/parsing */
  if (msg.type === Gst.MessageType.ERROR) {
    console.error(
      'An error occurred! Re-run with the GST_DEBUG=*:WARN environment variable set for more details.',
    );
  }

  /* Free resources */
  bus.unref();
  pipeline.setState(Gst.State.NULL);
  pipeline.unref();
});
