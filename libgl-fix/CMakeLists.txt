cmake_minimum_required(VERSION 3.0)
project(libgl-overrides)

find_package(PkgConfig REQUIRED)
pkg_check_modules(GL REQUIRED gl)

add_library(gl-override SHARED main.c)
target_link_libraries(gl-override dl)
install(TARGETS gl-override LIBRARY DESTINATION /usr/local/lib)
