import Gst from '@girs/node-gst-1.0';

/* Structure to contain all our information, so we can pass it around */
type CustomData = {
  /* Our one and only element */
  playbin?: Gst.Element;
  /* Are we in the PLAYING state? */
  playing: boolean;
  /* Should we terminate execution? */
  terminate: boolean;
  /* Is seeking enabled for this media? */
  seekEnabled: boolean;
  /* Have we performed the seek already? */
  seekDone: boolean;
  /* How long does this media last, in nanoseconds */
  duration: number;
};

it('Time management', async () => {
  const data: CustomData = {
    playing: false,
    terminate: false,
    seekEnabled: false,
    seekDone: false,
    duration: Gst.CLOCK_TIME_NONE,
  };

  /* Initialize GStreamer */
  Gst.init(null);

  /* Create the elements */
  data.playbin = Gst.ElementFactory.make('playbin', 'playbin');

  if (!data.playbin) {
    console.error('Not all elements could be created.');
    return;
  }

  /* Set the URI to play */
  data.playbin['uri'] =
    'https://gstreamer.freedesktop.org/data/media/sintel_trailer-480p.webm';

  /* Start playing */
  const ret = data.playbin.setState(Gst.State.PLAYING);
  if (ret === Gst.StateChangeReturn.FAILURE) {
    console.error('Unable to set the pipeline to the playing state.');
    data.playbin.unref();
    throw new Error();
  }

  /* Listen to the bus */
  const bus = data.playbin.getBus();
  do {
    const msg = bus.timedPopFiltered(
      100 * Gst.MSECOND,
      Gst.MessageType.STATE_CHANGED |
        Gst.MessageType.ERROR |
        Gst.MessageType.EOS |
        Gst.MessageType.DURATION_CHANGED,
    );

    /* Parse message */
    if (msg) {
      handleMessage(data, msg);
    } else {
      /* We got no message, this means the timeout expired */
      if (data.playing) {
        let current = -1;

        /* Query the current position of the stream */
        const [queryable, position] = data.playbin.queryPosition(
          Gst.Format.TIME,
        );
        if (queryable) {
          current = position;
        } else {
          console.error('Could not query current position.');
        }

        /* If we didn't know it yet, query the stream duration */
        if (data.duration === Gst.CLOCK_TIME_NONE) {
          const [queryable, duration] = data.playbin.queryDuration(
            Gst.Format.TIME,
          );
          if (queryable) {
            data.duration = duration;
          } else {
            console.error('Could not query current duration.');
          }
        }

        /* Print current position and total duration */
        console.log(
          `Position: ${current / Gst.SECOND}s / ${data.duration / Gst.SECOND}s`,
        );

        /* If seeking is enabled, we have not done it yet, and the time is right, seek */
        if (data.seekEnabled && !data.seekDone && current > 10 * Gst.SECOND) {
          console.log('Reached 10s, performing seek...');
          data.playbin.seekSimple(
            Gst.Format.TIME,
            Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
            30 * Gst.SECOND,
          );
          data.seekDone = true;
        }
      }
    }
  } while (!data.terminate);

  /* Free resources */
  bus.unref();
  data.playbin.setState(Gst.State.NULL);
  data.playbin.unref();
});

function handleMessage(data: CustomData, msg: Gst.Message) {
  switch (msg.type) {
    case Gst.MessageType.ERROR:
      const [err, debugInfo] = msg.parseError();
      console.error(
        `Error received from element ${msg.src.name}: ${err.message}`,
      );
      console.error(`Debugging information: ${debugInfo || 'none'}`);
      err.free();
      data.terminate = true;
      break;
    case Gst.MessageType.EOS:
      console.log('End-Of-Stream reached.');
      data.terminate = true;
      break;
    case Gst.MessageType.DURATION_CHANGED:
      /* The duration has changed, mark the current one as invalid */
      data.duration = Gst.CLOCK_TIME_NONE;
      break;
    case Gst.MessageType.STATE_CHANGED:
      const [oldState, newState, pendingState] = msg.parseStateChanged();
      if (msg.src === data.playbin) {
        const oldStateName = Gst.Element.stateGetName(oldState);
        const newStateName = Gst.Element.stateGetName(newState);
        console.log(
          `Pipeline state changed from ${oldStateName} to ${newStateName}`,
        );

        /* Remember whether we are in the PLAYING state or not */
        data.playing = newState === Gst.State.PLAYING;

        if (data.playing) {
          /* We just moved to PLAYING. Check if seeking is possible */
          const query = Gst.Query.newSeeking(Gst.Format.TIME);
          if (data.playbin.query(query)) {
            const [, seekable, start, end] = query.parseSeeking();
            data.seekEnabled = seekable;
            if (data.seekEnabled) {
              console.log(
                `Seeking is ENABLED from ${start / Gst.SECOND}s to ${end / Gst.SECOND}s`,
              );
            } else {
              console.log('Seeking is DISABLED for this stream.');
            }
          } else {
            console.error('Seeking query failed.');
          }
        }
      }
      break;
    default:
      /* We should not reach here */
      console.error('Unexpected message received.');
      break;
  }
}
