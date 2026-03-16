extends Camera3D

## Follows the player's XZ position while maintaining the camera's
## own fixed rotation (isometric top-down).  Offset is the initial
## transform origin, which stores the desired height and distance.

var _offset: Vector3

func _ready() -> void:
	_offset = position   # (0, 8, 10) from the scene transform

func _process(_delta: float) -> void:
	var players = get_tree().get_nodes_in_group("player")
	if players.size() == 0:
		return
	var player: Node3D = players[0]
	# Follow player XZ, keep our own Y offset
	position = player.global_position + _offset
