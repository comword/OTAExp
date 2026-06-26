#!/usr/bin/env bash
set -e

# -output-replacements-xml -style=file -fallback-style=LLVM -assume-filename=<abs-file-path>.cpp -offset=934 -length=69

# read input parameters from command line arguments
for var in "$@"
do
    case $var in
        *-assume-filename=*)
            assume_filename="${var#*=}"
            ;;
        *-offset=*)
            offset="${var#*=}"
            ;;
        *-length=*)
            length="${var#*=}"
            ;;
        *)
            ;;
    esac
done

# Get file extension
ext="${assume_filename##*.}"

# Check if 'ios' is in the filename
if [[ $assume_filename == *"ios"* && $ext == "h" ]] || [ "$ext" == "m" ] || [ "$ext" == "mm" ]; then
    style="file:$(dirname -- "$0")/.clang-format-objc"
else
    style="file:$(dirname -- "$0")/.clang-format"
fi

# construct command to invoke clang-format
cmd="clang-format -output-replacements-xml -style=$style -fallback-style=LLVM -assume-filename=$assume_filename"
if [ ! -z "$offset" ]; then
    cmd="$cmd -offset=$offset"
fi
if [ ! -z "$length" ]; then
    cmd="$cmd -length=$length"
fi

# invoke clang-format
eval $cmd
