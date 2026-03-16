cmake_minimum_required(VERSION 3.22.1)
project("sandbox")

add_library(${CMAKE_PROJECT_NAME} SHARED sandbox.cpp)

# We link to the prebuilt libgodot.so
add_library(godot SHARED IMPORTED)
set_target_properties(godot PROPERTIES IMPORTED_LOCATION
        ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../output/android/libgodot.so)

target_link_libraries(${CMAKE_PROJECT_NAME}
        godot
        android
        log)
