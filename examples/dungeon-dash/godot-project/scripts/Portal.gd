extends Area3D

## Portal — floor transition trigger.
## When the player enters, sends a LOAD_SCENE_ASYNC command to RNBridge
## which triggers the React Native loading screen (Epic 3).

@export var next_floor_path: String = "res://scenes/DungeonFloor2.tscn"

var _activated: bool = false

@onready var _mesh: Node3D = $Mesh

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _process(delta: float) -> void:
	# Slow rotate for visual effect
	if _mesh:
		_mesh.rotate_y(delta * 1.5)
	# Pulse alpha
	if _mesh and not _activated:
		var mat = _mesh.get_surface_override_material(0)
		if mat is StandardMaterial3D:
			var pulse = (sin(Time.get_ticks_msec() / 500.0) + 1.0) / 2.0
			mat.albedo_color.a = 0.5 + pulse * 0.5

func _on_body_entered(body: Node3D) -> void:
	if _activated:
		return
	if not body.is_in_group("player"):
		return

	_activated = true
	print("[Portal] Player entered — loading next floor: ", next_floor_path)

	# Notify React Native to show loading screen
	RNBridge.on_react_native_message(JSON.stringify({
		"action": "LOAD_SCENE_ASYNC",
		"path": next_floor_path
	}))
