import GLib from '@girs/node-glib-2.0';
import GObject from '@girs/node-gobject-2.0';
import Gst from '@girs/node-gst-1.0';

/* Functions below print the Capabilities in a human-friendly format */
function printField(field: GLib.Quark, value: GObject.Value, pfx: string) {
  const str = Gst.valueSerialize(value);

  process.stdout.write(`${pfx}  ${GLib.quarkToString(field)}: ${str}\n`);
  return true;
}

function printCaps(caps: Gst.Caps, pfx: string) {
  if (caps.isAny()) {
    process.stdout.write(`${pfx}ANY\n`);
    return;
  }
  if (caps.isEmpty()) {
    process.stdout.write(`${pfx}EMPTY\n`);
    return;
  }

  for (let i = 0; i < caps.getSize(); i++) {
    const structure = caps.getStructure(i);

    process.stdout.write(`${pfx}${structure.getName()}:\n`);
    structure.foreach((field, value) => printField(field, value, pfx));
  }
}

function printPadTemplatesInformation(factory: Gst.ElementFactory) {
  process.stdout.write(
    `Pad Templates of ${factory.getMetadata('long-name')}:\n`,
  );
  if (!factory.getNumPadTemplates()) {
    process.stdout.write('  none\n');
    return;
  }

  const pads = factory.getStaticPadTemplates();
  for (const pad of pads) {
    if (pad.direction === Gst.PadDirection.SRC) {
      process.stdout.write(`  SRC template: '${pad.nameTemplate}'\n`);
    } else if (pad.direction === Gst.PadDirection.SINK) {
      process.stdout.write(`  SINK template: '${pad.nameTemplate}'\n`);
    } else {
      process.stdout.write(`  UNKNOWN!!! template: '${pad.nameTemplate}'\n`);
    }

    if (pad.presence === Gst.PadPresence.ALWAYS) {
      process.stdout.write('    Availability: Always\n');
    } else if (pad.presence === Gst.PadPresence.SOMETIMES) {
      process.stdout.write('    Availability: Sometimes\n');
    } else if (pad.presence === Gst.PadPresence.REQUEST) {
      process.stdout.write('    Availability: On request\n');
    } else {
      process.stdout.write('    Availability: UNKNOWN!!!\n');
    }

    if (pad.getCaps()) {
      process.stdout.write('    Capabilities:\n');
      printCaps(pad.getCaps(), '      ');
    }

    process.stdout.write('\n');
  }
}

/* Shows the CURRENT capabilities of the requested pad in the given element */
function printPadCapabilities(element: Gst.Element, padName: string) {
  /* Retrieve pad */
  const pad = element.getStaticPad(padName);
  if (!pad) {
    console.error(`Could not retrieve pad '${padName}'`);
    return;
  }

  /* Retrieve negotiated caps (or acceptable caps if negotiation is not finished yet) */
  const caps = pad.getCurrentCaps() || pad.queryCaps(null);

  /* Print and free */
  process.stdout.write(`Caps for the ${padName} pad:\n`);
  printCaps(caps, '      ');
  pad.unref();
}

it('Media formats and Pad Capabilities', async () => {
  let terminate = false;

  /* Initialize GStreamer */
  Gst.init(null);

  /* Create the element factories */
  const sourceFactory = Gst.ElementFactory.find('audiotestsrc');
  const sinkFactory = Gst.ElementFactory.find('autoaudiosink');
  if (!sourceFactory || !sinkFactory) {
    console.error('Not all element factories could be created.');
    throw new Error();
  }

  /* Print information about the pad templates of these factories */
  printPadTemplatesInformation(sourceFactory);
  printPadTemplatesInformation(sinkFactory);

  /* Ask the factories to instantiate actual elements */
  const source = sourceFactory.create('source');
  const sink = sinkFactory.create('sink');

  /* Create the empty pipeline */
  const pipeline = new Gst.Pipeline();

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

  /* Print initial negotiated caps (in NULL state) */
  process.stdout.write('In NULL state:\n');
  printPadCapabilities(sink, 'sink');

  /* Start playing */
  const ret = pipeline.setState(Gst.State.PLAYING);
  if (ret === Gst.StateChangeReturn.FAILURE) {
    console.error(
      'Unable to set the pipeline to the playing state (check the bus for error messages).',
    );
  }

  /* Wait until error, EOS or State Change */
  const bus = pipeline.getBus();
  do {
    const msg = bus.timedPopFiltered(
      Gst.CLOCK_TIME_NONE,
      Gst.MessageType.ERROR |
        Gst.MessageType.EOS |
        Gst.MessageType.STATE_CHANGED,
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
          terminate = true;
          break;
        case Gst.MessageType.EOS:
          process.stdout.write('End-Of-Stream reached.\n');
          terminate = true;
          break;
        case Gst.MessageType.STATE_CHANGED:
          if (msg.src === pipeline) {
            const [oldState, newState, pendingState] = msg.parseStateChanged();
            const oldStateStr = Gst.Element.stateGetName(oldState);
            const newStateStr = Gst.Element.stateGetName(newState);
            process.stdout.write(
              `\nPipeline state changed from ${oldStateStr} to ${newStateStr}\n`,
            );
            /* Print the current capabilities of the sink element */
            printPadCapabilities(sink, 'sink');
          }
          break;
        default:
          /* We should not reach here because we only asked for ERRORs, EOS and STATE_CHANGED */
          console.error('Unexpected message received.');
          break;
      }
    }
  } while (!terminate);

  /* Free resources */
  bus.unref();
  pipeline.setState(Gst.State.NULL);
  pipeline.unref();
  sourceFactory.unref();
  sinkFactory.unref();
});
