extends Node

## Emitted whenever a message is received from React Native.
signal message_received(data: String)

# ─── Game State ──────────────────────────────────────────────────────────────
var player_node: Node = null
var current_floor: int = 1
var enemies_remaining: int = 0

# ─── Virtual Joystick State (written by _input, read by Player.gd) ───────────
## Move joystick: maps to X/Z movement velocity. Pointer index 0.
## Clamped to unit length so diagonal movement is never faster than cardinal.
var joystick_move := Vector2.ZERO
## Aim joystick: maps to character facing direction. Pointer index 1.
var joystick_aim := Vector2.ZERO

## Deadzone below which joystick input is treated as zero (prevents drift)
const JOYSTICK_DEADZONE: float = 0.05
## Maximum translation magnitude we expect from a gesture (px). Used to normalise.
const JOYSTICK_SCALE: float = 80.0

# ─── Outgoing Queue (Godot → JS) ────────────────────────────────────────────
var _outgoing_queue: Array[String] = []

# ─── Async Loading State ────────────────────────────────────────────────────
var _async_load_path: String = ""
var _async_loading: bool = false

# ─── State Sync Timer ───────────────────────────────────────────────────────
var _sync_timer: float = 0.0
const SYNC_INTERVAL: float = 1.0 / 60.0  # 60Hz state sync

func _ready() -> void:
	# Count initial enemies
	_recount_enemies()


# ══════════════════════════════════════════════════════════════════════════════
#  VIRTUAL JOYSTICK INPUT — intercepts C++-injected InputEventScreen* events
#  Our C++ _processInboundTouches() injects InputEventScreenDrag/Touch via
#  Input.parse_input_event(), which bubbles up through _input() globally.
# ══════════════════════════════════════════════════════════════════════════════

func _input(event: InputEvent) -> void:
	if event is InputEventScreenDrag:
		var drag := event as InputEventScreenDrag
		# Normalise raw pixel translation by a fixed scale factor and clamp to unit circle
		var normalised := Vector2(drag.relative.x, drag.relative.y) / JOYSTICK_SCALE
		normalised = normalised.limit_length(1.0)
		if drag.index == 0:
			joystick_move = normalised
		elif drag.index == 1:
			joystick_aim = normalised

	elif event is InputEventScreenTouch:
		var touch := event as InputEventScreenTouch
		if not touch.pressed:
			# Finger lifted — reset the corresponding joystick
			if touch.index == 0:
				joystick_move = Vector2.ZERO
			elif touch.index == 1:
				joystick_aim = Vector2.ZERO

# ══════════════════════════════════════════════════════════════════════════════
#  INCOMING (JS → Godot) — called by C++ _processInboundMessages()
# ══════════════════════════════════════════════════════════════════════════════

func on_react_native_message(payload: String) -> void:
	print("[RNBridge] Received: ", payload)
	emit_signal("message_received", payload)

	var parsed = JSON.parse_string(payload)
	if not parsed is Dictionary:
		return

	var action = parsed.get("action", "")
	match action:
		"MOVE":
			_handle_move(parsed)
		"ATTACK":
			_handle_attack()
		"USE_POTION":
			_handle_use_potion()
		"EQUIP":
			_handle_equip(parsed)
		"LOAD_SCENE_ASYNC":
			var path = parsed.get("path", "")
			if path != "":
				_start_async_load(path)

# ─── Intent Handlers ────────────────────────────────────────────────────────

func _handle_move(data: Dictionary) -> void:
	if not player_node:
		player_node = get_tree().get_first_node_in_group("player")
	if player_node and player_node.has_method("move_toward_point"):
		var tx = data.get("x", 0.0)
		var tz = data.get("z", 0.0)
		player_node.move_toward_point(Vector3(tx, 0, tz))

func _handle_attack() -> void:
	if not player_node:
		player_node = get_tree().get_first_node_in_group("player")
	if player_node and player_node.has_method("attack"):
		player_node.attack()

func _handle_use_potion() -> void:
	if not player_node:
		player_node = get_tree().get_first_node_in_group("player")
	if player_node and player_node.has_method("use_potion"):
		player_node.use_potion()

func _handle_equip(data: Dictionary) -> void:
	if not player_node:
		player_node = get_tree().get_first_node_in_group("player")
	if player_node and player_node.has_method("equip_next"):
		player_node.equip_next()

# ══════════════════════════════════════════════════════════════════════════════
#  OUTGOING (Godot → JS)
# ══════════════════════════════════════════════════════════════════════════════

func send_to_react_native(msg: String) -> void:
	_outgoing_queue.append(msg)

## Called by C++ _relayGodotMessages() via variant_call.
func poll_message() -> String:
	if _outgoing_queue.is_empty():
		return ""
	return _outgoing_queue.pop_front()

# ─── State Sync (Epic 5) ────────────────────────────────────────────────────

func sync_state_to_rn(data: Dictionary) -> void:
	send_to_react_native(JSON.stringify({
		"type": "STATE_SYNC",
		"data": data
	}))

func sync_full_state() -> void:
	if not player_node:
		player_node = get_tree().get_first_node_in_group("player")

	var player_data := {
		"health": 100,
		"weapon": "none",
		"ammo": 0,
		"position": {"x": 0.0, "y": 0.0, "z": 0.0}
	}

	if player_node and player_node.has_method("get_state"):
		player_data = player_node.get_state()

	# ── Enemy positions for Reanimated floating health bars (Epic 4) ──────────
	var enemies_data := {}
	for enemy in get_tree().get_nodes_in_group("enemies"):
		var e := enemy as Node3D
		if not e:
			continue
		enemies_data[e.name] = {
			"x": e.global_position.x,
			"y": e.global_position.y,
			"z": e.global_position.z,
			"health": e.health if "health" in e else 100
		}

	# ── GameManager state (NitroSwarm wave data) ──────────────────────────────
	var game_data := {
		"score": 0,
		"combo": 0,
		"waveNumber": current_floor,
		"enemyCount": enemies_remaining
	}
	if has_node("/root/GameManager"):
		var gm = get_node("/root/GameManager")
		game_data = {
			"score": gm.score,
			"combo": gm.combo,
			"waveNumber": gm.wave_number,
			"enemyCount": enemies_remaining
		}

	sync_state_to_rn({
		"player": player_data,
		"floor": {
			"current": current_floor,
			"enemiesRemaining": enemies_remaining
		},
		"game": game_data,
		"enemies": enemies_data
	})

# ─── Game Events ─────────────────────────────────────────────────────────────

func on_enemy_killed(enemy_name: String) -> void:
	enemies_remaining = max(0, enemies_remaining - 1)
	send_to_react_native(JSON.stringify({
		"type": "ENEMY_HIT",
		"enemy": enemy_name,
		"remaining": enemies_remaining
	}))
	sync_full_state()
	if enemies_remaining <= 0:
		send_to_react_native(JSON.stringify({
			"type": "FLOOR_CLEARED",
			"floor": current_floor
		}))

func on_item_picked_up(item_type: String, item_data: Dictionary) -> void:
	send_to_react_native(JSON.stringify({
		"type": "ITEM_PICKED_UP",
		"itemType": item_type,
		"data": item_data
	}))
	sync_full_state()

func on_player_damaged(new_health: int) -> void:
	sync_full_state()

# ─── Helper ──────────────────────────────────────────────────────────────────

func _recount_enemies() -> void:
	enemies_remaining = get_tree().get_nodes_in_group("enemies").size()

# ══════════════════════════════════════════════════════════════════════════════
#  PROCESS — State Sync Timer + Async Loading
# ══════════════════════════════════════════════════════════════════════════════

var _dbg_frame: int = 0
func _process(delta: float) -> void:
	# ── Debug: log joystick values from GDScript's perspective ──
	_dbg_frame += 1
	if _dbg_frame % 60 == 0 and (joystick_move.length() > 0.01 or joystick_aim.length() > 0.01):
		print("[RNBridge] joystick_move=", joystick_move, " aim=", joystick_aim)



	# ── Periodic state sync at 60Hz ──
	_sync_timer += delta
	if _sync_timer >= SYNC_INTERVAL:
		_sync_timer = 0.0
		sync_full_state()

	# ── Async scene loading (Epic 3) ──
	if not _async_loading:
		return

	var progress: Array = []
	var status = ResourceLoader.load_threaded_get_status(_async_load_path, progress)

	if status == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
		var value = progress[0] if progress.size() > 0 else 0.0
		send_to_react_native(JSON.stringify({
			"type": "LOAD_PROGRESS",
			"value": value
		}))

	elif status == ResourceLoader.THREAD_LOAD_LOADED:
		var resource = ResourceLoader.load_threaded_get(_async_load_path)
		_async_loading = false
		_async_load_path = ""
		current_floor += 1

		send_to_react_native(JSON.stringify({
			"type": "LOAD_COMPLETE"
		}))

		if resource is PackedScene:
			# Clear current enemies/collectibles
			for enemy in get_tree().get_nodes_in_group("enemies"):
				enemy.queue_free()
			for item in get_tree().get_nodes_in_group("collectibles"):
				item.queue_free()

			var new_scene = resource.instantiate()
			get_tree().root.add_child(new_scene)
			_recount_enemies()
			print("[RNBridge] Floor ", current_floor, " loaded")

	elif status == ResourceLoader.THREAD_LOAD_FAILED:
		_async_loading = false
		_async_load_path = ""
		send_to_react_native(JSON.stringify({
			"type": "LOAD_ERROR",
			"message": "Failed to load floor"
		}))

	elif status == ResourceLoader.THREAD_LOAD_INVALID_RESOURCE:
		_async_loading = false
		_async_load_path = ""
		send_to_react_native(JSON.stringify({
			"type": "LOAD_ERROR",
			"message": "Invalid resource path"
		}))

func _start_async_load(path: String) -> void:
	print("[RNBridge] Starting async load: ", path)
	_async_load_path = path
	_async_loading = true
	ResourceLoader.load_threaded_request(path)

# ══════════════════════════════════════════════════════════════════════════════
#  CAMERA DATA (Epic 4) — called by C++ _updateCameraCache()
# ══════════════════════════════════════════════════════════════════════════════

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
