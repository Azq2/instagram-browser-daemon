#!/bin/bash
export LC_ALL=ru_RU
export MESA_LOADER_DRIVER_OVERRIDE=swrast
export LD_PRELOAD=/usr/local/lib/libgl-override.so
linux32 /usr/bin/google-chrome $@
exit $?
