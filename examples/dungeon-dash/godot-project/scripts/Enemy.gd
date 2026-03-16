extends CharacterBody3D

## Simple enemy with patrol + chase behavior.
## Patrols between two points. Chases player within detection range.
## Deals contact damage. Dies when health reaches 0.

const PATROL_SPEED: float = 2.0
const CHASE_SPEED: float = 3.5
const DETECTION_RANGE: float = 6.0
const CONTACT_DAMAGE: int = 10
const DAMAGE_COOLDOWN: float = 1.0
const GRAVITY: float = 9.8

@export var max_health: int = 50
@export var patrol_distance: float = 3.0

var health: int = 50
var _spawn_position: Vector3
var _patrol_target_a: Vector3
var _patrol_target_b: Vector3
var _going_to_b: bool = true
var _damage_timer: float = 0.0
var _is_dead: bool = false

@onready var _mesh: Node3D = $Mesh

func _ready() -> void:
	add_to_group("enemies")
	health = max_health
	_spawn_position = global_position
	_patrol_target_a = _spawn_position + Vector3(-patrol_distance, 0, 0)
	_patrol_target_b = _spawn_position + Vector3(patrol_distance, 0, 0)

func _physics_process(delta: float) -> void:
	if _is_dead:
		return

	# ── Gravity ──
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = 0.0

	# ── Damage cooldown ──
	if _damage_timer > 0:
		_damage_timer -= delta

	# ── Find player ──
	var player = _get_player()
	var dist_to_player := INF
	if player:
		dist_to_player = global_position.distance_to(player.global_position)

	# ── Chase or Patrol ──
	if player and dist_to_player < DETECTION_RANGE:
		_chase(player, delta)
		# Contact damage
		if dist_to_player < 1.2 and _damage_timer <= 0:
			_damage_timer = DAMAGE_COOLDOWN
			if player.has_method("take_damage"):
				player.take_damage(CONTACT_DAMAGE)
	else:
		_patrol(delta)

	move_and_slide()

func _patrol(delta: float) -> void:
	var target = _patrol_target_b if _going_to_b else _patrol_target_a
	var dir = (target - global_position)
	dir.y = 0.0

	if dir.length() < 0.5:
		_going_to_b = not _going_to_b
		return

	dir = dir.normalized()
	velocity.x = dir.x * PATROL_SPEED
	velocity.z = dir.z * PATROL_SPEED

func _chase(player: Node3D, delta: float) -> void:
	var dir = (player.global_position - global_position)
	dir.y = 0.0
	if dir.length() > 0.3:
		dir = dir.normalized()
		velocity.x = dir.x * CHASE_SPEED
		velocity.z = dir.z * CHASE_SPEED
	else:
		velocity.x = 0.0
		velocity.z = 0.0

func _get_player() -> Node3D:
	var players = get_tree().get_nodes_in_group("player")
	if players.size() > 0:
		return players[0] as Node3D
	return null

# ── Damage ───────────────────────────────────────────────────────────────────

func take_damage(amount: int) -> void:
	if _is_dead:
		return
	health -= amount

	# Flash red
	if _mesh:
		var mat = _mesh.get_surface_override_material(0)
		if mat is StandardMaterial3D:
			mat.albedo_color = Color(1.0, 0.2, 0.2)
			# Reset after a short time
			get_tree().create_timer(0.15).timeout.connect(func():
				if _mesh and not _is_dead:
					var m = _mesh.get_surface_override_material(0)
					if m is StandardMaterial3D:
						m.albedo_color = Color(0.9, 0.2, 0.2)
			)

	if health <= 0:
		_die()

func _die() -> void:
	_is_dead = true
	RNBridge.on_enemy_killed(name)
	# Notify GameManager for score/combo tracking
	if has_node("/root/GameManager"):
		get_node("/root/GameManager").on_enemy_killed()
	# Shrink and vanish
	var tween = create_tween()
	tween.tween_property(self, "scale", Vector3(0.01, 0.01, 0.01), 0.3)
	tween.tween_callback(queue_free)
