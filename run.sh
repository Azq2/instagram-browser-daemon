#!/bin/bash
dir=$(dirname "$0")
dir=$(readlink -f "$dir")

while true; do
	node "$dir" | tee "$dir/instagram.log"
	sleep 1
done
