extends Node

## Emitted whenever a message is received from React Native.
signal message_received(data: String)

## Called by HybridGodotEngine::sendMessage() via GDExtension variant_call.
## The method name "on_react_native_message" is hard-coded on the C++ side.
##
## Register this script as an AutoLoad singleton named "RNBridge" in:
##   Project → Project Settings → AutoLoad
##
## This creates the node at /root/RNBridge which the C++ code finds via:
##   get_node("/root/RNBridge")
func on_react_native_message(payload: String) -> void:
	print("[Godot] Received from React Native: ", payload)
	emit_signal("message_received", payload)

	# ── Epic 3: Async scene loading command handling ──────────────────
	var parsed = JSON.parse_string(payload)
	if parsed is Dictionary:
		var action = parsed.get("action", "")
		if action == "LOAD_SCENE_ASYNC":
			var scene_path = parsed.get("path", "")
			if scene_path != "":
				_start_async_load(scene_path)

# ── Godot → JS outgoing message queue ────────────────────────────────────
# NOTE: This queue is the INTERIM bridge for Epic 1.
# The C++ HybridGodotEngine::_relayGodotMessages() drains this queue
# into the lock-free SPSC queue on each pollMessage() call.
# Once a proper GDExtension callback replaces this, the queue will be removed.

## Queue of messages waiting to be polled by JS.
var _outgoing_queue: Array[String] = []

## Call this from any GDScript to send a message to React Native.
## JS side retrieves it via engine.pollMessage() → SPSC queue.
##
## @example
##   RNBridge.send_to_react_native("score:42")
##   RNBridge.send_to_react_native(JSON.stringify({"event": "game_over", "score": 42}))
func send_to_react_native(msg: String) -> void:
	_outgoing_queue.append(msg)

## Called by HybridGodotEngine::_relayGodotMessages() via GDExtension variant_call.
## Returns the next queued message, or "" if the queue is empty.
func poll_message() -> String:
	if _outgoing_queue.is_empty():
		return ""
	return _outgoing_queue.pop_front()

# ── Epic 3: Async Scene Loading ──────────────────────────────────────────

var _async_load_path: String = ""
var _async_loading: bool = false

## Starts threaded loading of a heavy scene/resource.
## Progress events are pushed to the outgoing queue for JS consumption.
func _start_async_load(path: String) -> void:
	print("[RNBridge] Starting async load: ", path)
	_async_load_path = path
	_async_loading = true
	ResourceLoader.load_threaded_request(path)

## Poll loading progress every frame and push to outgoing queue.
func _process(_delta: float) -> void:
	if not _async_loading:
		return

	var progress: Array = []
	var status = ResourceLoader.load_threaded_get_status(_async_load_path, progress)

	if status == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
		# Push progress payload for JS consumption
		var value = progress[0] if progress.size() > 0 else 0.0
		send_to_react_native(JSON.stringify({
			"type": "LOAD_PROGRESS",
			"value": value
		}))

	elif status == ResourceLoader.THREAD_LOAD_LOADED:
		# Loading complete — get the resource
		var resource = ResourceLoader.load_threaded_get(_async_load_path)
		_async_loading = false
		_async_load_path = ""

		send_to_react_native(JSON.stringify({
			"type": "LOAD_COMPLETE"
		}))

		# If it's a PackedScene, add it to the tree
		if resource is PackedScene:
			var scene = resource.instantiate()
			get_tree().root.add_child(scene)
			print("[RNBridge] Async loaded scene added to tree")

	elif status == ResourceLoader.THREAD_LOAD_FAILED:
		_async_loading = false
		_async_load_path = ""
		send_to_react_native(JSON.stringify({
			"type": "LOAD_ERROR",
			"message": "Failed to load resource"
		}))
		print("[RNBridge] ERROR: Async load failed")

	elif status == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
		_async_loading = false
		_async_load_path = ""
		send_to_react_native(JSON.stringify({
			"type": "LOAD_ERROR",
			"message": "Invalid resource path"
		}))
		print("[RNBridge] ERROR: Invalid resource path")

# ── Epic 5: State Sync helper ───────────────────────────────────────────
# Convenience method for pushing authoritative state updates to React Native.
# Call this from any game script to sync state to the RN observable store.

## Push a state update to React Native's Legend-State observable store.
## @param data  Dictionary of state to sync, e.g. {"player": {"health": 80}}
func sync_state_to_rn(data: Dictionary) -> void:
	send_to_react_native(JSON.stringify({
		"type": "STATE_SYNC",
		"data": data
	}))

# ── Epic 4: Camera Matrix Cache ──────────────────────────────────────────
# Called by C++ _updateCameraCache() via variant_call on the Godot thread.
# Returns a PackedFloat32Array of 34 floats:
#   [view_matrix(16), proj_matrix(16), viewport_width, viewport_height]
# Returns an empty array if no Camera3D is active.

func get_camera_data() -> PackedFloat32Array:
	var viewport := get_viewport()
	if not viewport:
		return PackedFloat32Array()

	var camera := viewport.get_camera_3d()
	if not camera or not camera.current:
		return PackedFloat32Array()

	var result := PackedFloat32Array()
	result.resize(34)

	# View matrix (camera transform inverse) — column-major 4×4
	var view: Transform3D = camera.get_camera_transform().affine_inverse()
	var vb := view.basis
	var vo := view.origin
	# Column 0
	result[0]  = vb.x.x; result[1]  = vb.x.y; result[2]  = vb.x.z; result[3]  = 0.0
	# Column 1
	result[4]  = vb.y.x; result[5]  = vb.y.y; result[6]  = vb.y.z; result[7]  = 0.0
	# Column 2
	result[8]  = vb.z.x; result[9]  = vb.z.y; result[10] = vb.z.z; result[11] = 0.0
	# Column 3 (translation)
	result[12] = vo.x;   result[13] = vo.y;   result[14] = vo.z;   result[15] = 1.0

	# Projection matrix — column-major 4×4
	var proj: Projection = camera.get_camera_projection()
	for col in range(4):
		var c: Vector4 = proj[col]
		result[16 + col * 4 + 0] = c.x
		result[16 + col * 4 + 1] = c.y
		result[16 + col * 4 + 2] = c.z
		result[16 + col * 4 + 3] = c.w

	# Viewport size
	var vp_size := viewport.get_visible_rect().size
	result[32] = vp_size.x
	result[33] = vp_size.y

	return result
