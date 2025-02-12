import Gdk from '@girs/node-gdk-3.0';
import GLib from '@girs/node-glib-2.0';
import GObject from '@girs/node-gobject-2.0';
import Gst from '@girs/node-gst-1.0';
import Gtk from '@girs/node-gtk-3.0';

/* Structure to contain all our information, so we can pass it around */
type CustomData = {
  /* Our one and only pipeline */
  playbin?: Gst.Element;

  /* The widget where our video will be displayed */
  sinkWidget?: Gtk.Widget;
  /* Slider widget to keep track of current position */
  slider?: Gtk.Scale;
  /* Text widget to display info about the streams */
  streamsList?: Gtk.TextView;
  /* Signal ID for the slider update signal */
  sliderUpdateSignalId: number;

  /* Current state of the pipeline */
  state?: Gst.State;
  /* Duration of the clip, in nanoseconds */
  duration: number;
};

/* This function is called when the PLAY button is clicked */
function playCb(button: Gtk.Button, data: CustomData) {
  data.playbin.setState(Gst.State.PLAYING);
}

/* This function is called when the PAUSE button is clicked */
function pauseCb(button: Gtk.Button, data: CustomData) {
  data.playbin.setState(Gst.State.PAUSED);
}

/* This function is called when the STOP button is clicked */
function stopCb(button: Gtk.Button, data: CustomData) {
  data.playbin.setState(Gst.State.READY);
}

/* This function is called when the main window is closed */
function deleteEventCb(widget: Gtk.Widget, event: Gdk.Event, data: CustomData) {
  stopCb(null, data);
  Gtk.mainQuit();
}

/* This function is called when the slider changes its position. We perform a seek to the
 * new position here. */
function sliderCb(range: Gtk.Range, data: CustomData) {
  const value = data.slider.getValue();
  data.playbin.seekSimple(
    Gst.Format.TIME,
    Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
    value * Gst.SECOND,
  );
}

/* This creates all the GTK+ widgets that compose our application, and registers the callbacks */
function createUi(data: CustomData) {
  const mainWindow = Gtk.Window.new(Gtk.WindowType.TOPLEVEL);
  mainWindow.connect('delete-event', (event: Gdk.Event) => {
    deleteEventCb(mainWindow, event, data);
  });

  const playButton = Gtk.Button.newFromIconName(
    'media-playback-start',
    Gtk.IconSize.SMALL_TOOLBAR,
  );
  playButton.connect('clicked', () => {
    playCb(playButton, data);
  });

  const pauseButton = Gtk.Button.newFromIconName(
    'media-playback-pause',
    Gtk.IconSize.SMALL_TOOLBAR,
  );
  pauseButton.connect('clicked', () => {
    pauseCb(playButton, data);
  });

  const stopButton = Gtk.Button.newFromIconName(
    'media-playback-stop',
    Gtk.IconSize.SMALL_TOOLBAR,
  );
  stopButton.connect('clicked', () => {
    stopCb(playButton, data);
  });

  data.slider = Gtk.Scale.newWithRange(Gtk.Orientation.HORIZONTAL, 0, 100, 1);
  data.slider.setDrawValue(false);
  data.sliderUpdateSignalId = data.slider.connect('value-changed', () => {
    sliderCb(data.slider, data);
  });

  data.streamsList = Gtk.TextView.new();
  data.streamsList.setEditable(false);

  const controls = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0);
  controls.packStart(playButton, false, false, 2);
  controls.packStart(pauseButton, false, false, 2);
  controls.packStart(stopButton, false, false, 2);
  controls.packStart(data.slider, true, true, 2);

  const mainHbox = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0);
  mainHbox.packStart(data.sinkWidget, true, true, 0);
  mainHbox.packStart(data.streamsList, false, false, 2);

  const mainBox = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0);
  mainBox.packStart(mainHbox, true, true, 0);
  mainBox.packStart(controls, false, false, 0);
  mainWindow.add(mainBox);
  mainWindow.setDefaultSize(640, 480);

  mainWindow.showAll();
}

/* This function is called periodically to refresh the GUI */
function refreshUi(data: CustomData) {
  /* We do not want to update anything unless we are in the PAUSED or PLAYING states */
  if (data.state < Gst.State.PAUSED) {
    return true;
  }

  /* If we didn't know it yet, query the stream duration */
  if (data.duration === Gst.CLOCK_TIME_NONE) {
    const [queryable, duration] = data.playbin.queryDuration(Gst.Format.TIME);
    if (queryable) {
      data.duration = duration;
      /* Set the range of the slider to the clip duration, in SECONDS */
      data.slider.setRange(0, data.duration / Gst.SECOND);
    } else {
      console.error('Could not query current duration.');
    }
  }

  const [queryable, current] = data.playbin.queryPosition(Gst.Format.TIME);
  if (queryable) {
    /* Block the "value-changed" signal, so the slider_cb function is not called
     * (which would trigger a seek the user has not requested) */
    GObject.signalHandlerBlock(data.slider, data.sliderUpdateSignalId);
    /* Set the position of the slider to the current pipeline position, in SECONDS */
    data.slider.setValue(current / Gst.SECOND);
    /* Re-enable the signal */
    GObject.signalHandlerUnblock(data.slider, data.sliderUpdateSignalId);
  }
  return true;
}

/* This function is called when new metadata is discovered in the stream */
function tagsCb(playbin: Gst.Element, stream: number, data: CustomData) {
  /* We are possibly in a GStreamer working thread, so we notify the main
   * thread of this event through a message in the bus */
  playbin.postMessage(
    Gst.Message.newApplication(playbin, Gst.Structure.newEmpty('tags-changed')),
  );
}

/* This function is called when an error message is posted on the bus */
function errorCb(bus: Gst.Bus, msg: Gst.Message, data: CustomData) {
  /* Print error details on the screen */
  const [err, debugInfo] = msg.parseError();
  console.error(
    `Error received from element ${msg.src.getName()}: ${err.message}`,
  );
  console.error(`Debugging information: ${debugInfo || 'none'}`);
  err.free();

  /* Set the pipeline to READY (which stops playback) */
  data.playbin.setState(Gst.State.READY);
}

/* This function is called when an End-Of-Stream message is posted on the bus.
 * We just set the pipeline to READY (which stops playback) */
function eosCb(bus: Gst.Bus, msg: Gst.Message, data: CustomData) {
  console.error('End-Of-Stream reached.');
  data.playbin.setState(Gst.State.READY);
}

/* This function is called when the pipeline changes states. We use it to
 * keep track of the current state. */
function stateChangedCb(bus: Gst.Bus, msg: Gst.Message, data: CustomData) {
  const [oldState, newState, pendingState] = msg.parseStateChanged();
  if (msg.src === data.playbin) {
    data.state = newState;
    console.log(`State set to ${Gst.Element.stateGetName(newState)}`);
    if (oldState === Gst.State.READY && newState === Gst.State.PAUSED) {
      /* For extra responsiveness, we refresh the GUI as soon as we reach the PAUSED state */
      refreshUi(data);
    }
  }
}

/* Extract metadata from all the streams and write it to the text widget in the GUI */
function analyzeStreams(data: CustomData) {
  /* Clean current contents of the widget */
  const text = data.streamsList.getBuffer();
  text.setText('', -1);

  /* Read some properties */
  const nVideo: number = data.playbin['n-video'];
  const nAudio: number = data.playbin['n-audio'];
  const nText: number = data.playbin['n-text'];

  for (let i = 0; i < nVideo; i++) {
    /* Retrieve the stream's video tags */
    const returnValue = new GObject.Value();
    returnValue.init(GObject.typeFromName(Gst.TagList.name));
    const [, signalId, detail] = GObject.signalParseName(
      'get-video-tags',
      GObject.typeFromName(
        GObject.typeNameFromInstance(data.playbin.gTypeInstance),
      ),
      false,
    );
    GObject.signalEmitv([data.playbin, i], signalId, detail, returnValue);
    const tags = returnValue.getBoxed<Gst.TagList>();
    if (tags) {
      text.insertAtCursor(`video stream ${i}:\n`, -1);
      const [, videoCodec] = tags.getString(Gst.TAG_VIDEO_CODEC);
      if (videoCodec) {
        text.insertAtCursor(`  codec: ${videoCodec || 'unknown'}\n`, -1);
      }
    }
  }

  for (let i = 0; i < nAudio; i++) {
    /* Retrieve the stream's audio tags */
    const returnValue = new GObject.Value();
    returnValue.init(GObject.typeFromName(Gst.TagList.name));
    const [, signalId, detail] = GObject.signalParseName(
      'get-audio-tags',
      GObject.typeFromName(
        GObject.typeNameFromInstance(data.playbin.gTypeInstance),
      ),
      false,
    );
    GObject.signalEmitv([data.playbin, i], signalId, detail, returnValue);
    const tags = returnValue.getBoxed<Gst.TagList>();
    if (tags) {
      text.insertAtCursor(`audio stream ${i}:\n`, -1);
      const [, audioCodec] = tags.getString(Gst.TAG_AUDIO_CODEC);
      if (audioCodec) {
        text.insertAtCursor(`  codec: ${audioCodec || 'unknown'}\n`, -1);
      }
      const [, languageCode] = tags.getString(Gst.TAG_LANGUAGE_CODE);
      if (languageCode) {
        text.insertAtCursor(`  language: ${languageCode || 'unknown'}\n`, -1);
      }
      const [, bitrate] = tags.getString(Gst.TAG_BITRATE);
      if (bitrate) {
        text.insertAtCursor(`  bitrate: ${bitrate || 'unknown'}\n`, -1);
      }
    }
  }

  for (let i = 0; i < nText; i++) {
    /* Retrieve the stream's subtitle tags */
    const returnValue = new GObject.Value();
    returnValue.init(GObject.typeFromName(Gst.TagList.name));
    const [, signalId, detail] = GObject.signalParseName(
      'get-text-tags',
      GObject.typeFromName(
        GObject.typeNameFromInstance(data.playbin.gTypeInstance),
      ),
      false,
    );
    GObject.signalEmitv([data.playbin, i], signalId, detail, returnValue);
    const tags = returnValue.getBoxed<Gst.TagList>();
    if (tags) {
      text.insertAtCursor(`subtitle stream ${i}:\n`, -1);
      const [, languageCode] = tags.getString(Gst.TAG_LANGUAGE_CODE);
      if (languageCode) {
        text.insertAtCursor(`  language: ${languageCode || 'unknown'}\n`, -1);
      }
    }
  }
}

/* This function is called when an "application" message is posted on the bus.
 * Here we retrieve the message posted by the tags_cb callback */
function applicationCb(bus: Gst.Bus, msg: Gst.Message, data: CustomData) {
  const structure = msg.getStructure();
  if (structure && structure.getName() === 'tags-changed') {
    /* If the message is the "tags-changed" (only one we are currently issuing), update
     * the stream info GUI */
    analyzeStreams(data);
  }
}

it('GUI toolkit integration', async () => {
  /* Initialize GTK */
  Gtk.init(null);

  /* Initialize GStreamer */
  Gst.init(null);

  /* Initialize our data structure */
  const data: CustomData = {
    sliderUpdateSignalId: 0,
    duration: Gst.CLOCK_TIME_NONE,
  };

  /* Create the elements */
  data.playbin = Gst.ElementFactory.make('playbin', 'playbin');
  let videosink = Gst.ElementFactory.make('glsinkbin', 'glsinkbin');
  const gtkglsink = Gst.ElementFactory.make('gtkglsink', 'gtkglsink');

  /* Here we create the GTK Sink element which will provide us with a GTK widget where
   * GStreamer will render the video at and we can add to our UI.
   * Try to create the OpenGL version of the video sink, and fallback if that fails */
  if (gtkglsink && videosink) {
    console.error('Successfully created GTK GL Sink');

    videosink['sink'] = gtkglsink;

    /* The gtkglsink creates the gtk widget for us. This is accessible through a property.
     * So we get it and use it later to add it to our gui. */
    data.sinkWidget = gtkglsink['widget'];
  } else {
    console.error('Could not create gtkglsink, falling back to gtksink.');

    videosink = Gst.ElementFactory.make('gtksink', 'gtksink');
    data.sinkWidget = videosink['widget'];
  }

  if (!data.playbin || !videosink) {
    console.error('Not all elements could be created.');
    throw new Error();
  }

  /* Set the URI to play */
  data.playbin['uri'] =
    'https://gstreamer.freedesktop.org/data/media/sintel_trailer-480p.webm';

  /* Set the video-sink  */
  const gValue = new GObject.Value();
  gValue.init(GObject.typeFromName(Gst.Element.name));
  gValue.setObject(videosink);
  data.playbin.setProperty('video-sink', gValue);
  gValue.unset();

  /* Connect to interesting signals in playbin */
  data.playbin.connect('video-tags-changed', (stream: number) => {
    tagsCb(data.playbin, stream, data);
  });
  data.playbin.connect('audio-tags-changed', (stream: number) => {
    tagsCb(data.playbin, stream, data);
  });
  data.playbin.connect('text-tags-changed', (stream: number) => {
    tagsCb(data.playbin, stream, data);
  });

  /* Create the GUI */
  createUi(data);

  /* Instruct the bus to emit signals for each received message, and connect to the interesting signals */
  const bus = data.playbin.getBus();
  bus.addSignalWatch();
  bus.connect('message::error', (msg: Gst.Message) => {
    errorCb(bus, msg, data);
  });
  bus.connect('message::eos', (msg: Gst.Message) => {
    eosCb(bus, msg, data);
  });
  bus.connect('message::state-changed', (msg: Gst.Message) => {
    stateChangedCb(bus, msg, data);
  });
  bus.connect('message::application', (msg: Gst.Message) => {
    applicationCb(bus, msg, data);
  });
  bus.unref();

  /* Start playing */
  data.playbin.setState(Gst.State.PAUSED);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const ret = data.playbin.setState(Gst.State.PLAYING);
  if (ret === Gst.StateChangeReturn.FAILURE) {
    console.error('Unable to set the pipeline to the playing state.');
    data.playbin.unref();
    videosink.unref();
    throw new Error();
  }

  /* Register a function that GLib will call every second */
  GLib.timeoutAddSeconds(GLib.PRIORITY_DEFAULT, 1, () => {
    return refreshUi(data);
  });

  /* Start the GTK main loop. We will not regain control until gtk_main_quit is called. */
  Gtk.main();

  /* Free resources */
  data.playbin.setState(Gst.State.NULL);
  data.playbin.unref();
  videosink.unref();
});
