#!/bin/bash

export DEBIAN_FRONTEND=noninteractive

apt update && apt install -y \
  gobject-introspection \
  libgirepository1.0-dev \
  gir1.2-glib-2.0 \
  gir1.2-gstreamer-1.0 \
  gir1.2-gst-plugins-base-1.0 \
  gir1.2-gst-plugins-bad-1.0 \
  gir1.2-gst-rtsp-server-1.0