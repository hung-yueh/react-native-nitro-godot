extends Area3D

## Collectible item — rotates and bobs. Picked up on player body entering.
## Triggers RNBridge.on_item_picked_up() and updates player state.

@export_enum("sword", "crossbow", "potion") var item_type: String = "sword"
@export var ammo_amount: int = 10

var _time: float = 0.0
var _start_y: float = 0.0

@onready var _mesh: Node3D = $Mesh

func _ready() -> void:
	add_to_group("collectibles")
	_start_y = global_position.y
	body_entered.connect(_on_body_entered)

func _process(delta: float) -> void:
	_time += delta
	# Bob up/down
	if _mesh:
		_mesh.position.y = sin(_time * 2.0) * 0.15
	# Rotate
	rotate_y(delta * 2.0)

func _on_body_entered(body: Node3D) -> void:
	if not body.is_in_group("player"):
		return

	if item_type == "potion":
		if body.has_method("collect_potion"):
			body.collect_potion()
	else:
		if body.has_method("collect_weapon"):
			body.collect_weapon(item_type, ammo_amount)

	# Remove with a little pop effect
	var tween = create_tween()
	tween.tween_property(self, "scale", Vector3(1.5, 1.5, 1.5), 0.1)
	tween.tween_property(self, "scale", Vector3(0.01, 0.01, 0.01), 0.15)
	tween.tween_callback(queue_free)
