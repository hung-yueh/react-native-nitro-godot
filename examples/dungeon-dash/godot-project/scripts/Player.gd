extends CharacterBody3D

## Player controller for Dungeon Dash.
## Responds to intents from React Native via RNBridge:
##   MOVE — walk toward a world-space point
##   ATTACK — melee swing in facing direction
##   USE_POTION — restore health
##   EQUIP — cycle through collected weapons

const SPEED: float = 5.0
const JOYSTICK_SPEED: float = 7.0   # Slightly faster than tap-to-move for responsiveness
const ATTACK_RANGE: float = 2.0
const ATTACK_DAMAGE: int = 25
const ATTACK_COOLDOWN: float = 0.5
const MAX_HEALTH: int = 100
const POTION_HEAL: int = 30
const GRAVITY: float = 9.8
const INVINCIBILITY_TIME: float = 0.5

var health: int = MAX_HEALTH
var weapon: String = "fists"
var ammo: int = 0
var potions: int = 1
var _target_position: Vector3 = Vector3.ZERO
var _has_target: bool = false
var _attack_timer: float = 0.0
var _invincibility_timer: float = 0.0
var _weapons_collected: Array[String] = ["fists"]
var _weapon_index: int = 0
var _is_attacking: bool = false

@onready var _mesh: Node3D = $Mesh
@onready var _attack_area: Area3D = $AttackArea

func _ready() -> void:
	add_to_group("player")
	_target_position = global_position
	push_warning("[Player] _ready called! pos=", global_position)

var _dbg_frame: int = 0
func _physics_process(delta: float) -> void:
	# ── Debug logging (unconditional) ──
	_dbg_frame += 1
	if _dbg_frame % 120 == 1:
		push_warning("[Player] f=", _dbg_frame, " pos=", global_position, " vel=", velocity, " floor=", is_on_floor(), " stick=", RNBridge.joystick_move)

	# ── Gravity ──
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = 0.0

	# ── Movement priority: joystick overrides tap-to-move when active ──
	var stick := RNBridge.joystick_move
	if stick.length() > RNBridge.JOYSTICK_DEADZONE:
		# Twin-stick move: map joystick X/Y to world X/Z
		velocity.x = stick.x * JOYSTICK_SPEED
		velocity.z = stick.y * JOYSTICK_SPEED
		# Clear any tap-to-move target so it doesn't fight the stick
		_has_target = false
	elif _has_target:
		# Original tap-to-move logic
		var dir := (_target_position - global_position)
		dir.y = 0.0
		var dist := dir.length()
		if dist > 0.3:
			dir = dir.normalized()
			velocity.x = dir.x * SPEED
			velocity.z = dir.z * SPEED
		else:
			velocity.x = 0.0
			velocity.z = 0.0
			_has_target = false
	else:
		velocity.x = move_toward(velocity.x, 0, SPEED * delta * 5)
		velocity.z = move_toward(velocity.z, 0, SPEED * delta * 5)

	move_and_slide()

	# ── Facing direction: controlled by aim joystick or velocity ──
	var aim := RNBridge.joystick_aim
	if aim.length() > RNBridge.JOYSTICK_DEADZONE:
		# Aim stick determines facing: map joystick X/Y → world X/Z
		var aim_dir := Vector3(aim.x, 0.0, aim.y)
		if aim_dir.length_squared() > 0.01:
			var look_target := global_position + aim_dir
			look_at(look_target, Vector3.UP)
	else:
		# Face velocity direction when moving (original behaviour)
		var flat_vel := Vector3(velocity.x, 0.0, velocity.z)
		if flat_vel.length_squared() > 0.01:
			look_at(global_position + flat_vel.normalized(), Vector3.UP)

	# ── Timers ──
	if _attack_timer > 0:
		_attack_timer -= delta
	if _invincibility_timer > 0:
		_invincibility_timer -= delta

	# ── Auto-attack: when aim stick is active and enemies are in range ──
	if aim.length() > RNBridge.JOYSTICK_DEADZONE and _attack_timer <= 0:
		attack()

	# ── Attack animation flash reset ──
	if _is_attacking:
		_is_attacking = false
		if _mesh:
			var mat = _mesh.get_surface_override_material(0)
			if mat is StandardMaterial3D:
				mat.albedo_color = Color(0.2, 0.9, 0.4)  # restore green

# ── Intent Handlers (called by RNBridge) ─────────────────────────────────────

func move_toward_point(target: Vector3) -> void:
	_target_position = target
	_target_position.y = global_position.y  # Keep on floor plane
	_has_target = true

func attack() -> void:
	if _attack_timer > 0:
		return  # On cooldown
	_attack_timer = ATTACK_COOLDOWN
	_is_attacking = true

	# Flash the mesh red briefly
	if _mesh:
		var mat = _mesh.get_surface_override_material(0)
		if mat is StandardMaterial3D:
			mat.albedo_color = Color(1.0, 0.3, 0.3)

	# Deal damage to enemies in attack area
	if _attack_area:
		for body in _attack_area.get_overlapping_bodies():
			if body.is_in_group("enemies") and body.has_method("take_damage"):
				body.take_damage(ATTACK_DAMAGE)
				# Consume ammo for ranged weapons
				if weapon != "fists" and weapon != "sword":
					ammo = max(0, ammo - 1)
					if ammo <= 0:
						_cycle_to_weapon("fists")

func use_potion() -> void:
	if potions <= 0:
		return
	potions -= 1
	health = min(MAX_HEALTH, health + POTION_HEAL)
	RNBridge.sync_full_state()

func equip_next() -> void:
	if _weapons_collected.size() <= 1:
		return
	_weapon_index = (_weapon_index + 1) % _weapons_collected.size()
	weapon = _weapons_collected[_weapon_index]
	RNBridge.sync_full_state()

func _cycle_to_weapon(w: String) -> void:
	weapon = w
	_weapon_index = _weapons_collected.find(w)
	if _weapon_index < 0:
		_weapon_index = 0
		weapon = _weapons_collected[0]

# ── Damage / Pickup ──────────────────────────────────────────────────────────

func take_damage(amount: int) -> void:
	var msg := "[Player] take_damage(%d) health=%d invincibility=%.2f" % [amount, health, _invincibility_timer]
	print(msg)
	RNBridge.send_to_react_native(JSON.stringify({"type": "DEBUG", "msg": msg}))
	if _invincibility_timer > 0:
		return  # I-frames
	_invincibility_timer = INVINCIBILITY_TIME
	health = max(0, health - amount)
	var hit_msg := "[Player] HIT! health now=%d" % health
	print(hit_msg)
	RNBridge.send_to_react_native(JSON.stringify({"type": "DEBUG", "msg": hit_msg}))
	RNBridge.on_player_damaged(health)

	if health <= 0:
		# Respawn away from arena center (enemies converge there)
		health = MAX_HEALTH
		global_position = Vector3(0, 0.7, -5)
		_has_target = false
		velocity = Vector3.ZERO
		_invincibility_timer = 2.0  # 2s grace period after respawn
		print("[Player] RESPAWNED at safe position")
		RNBridge.send_to_react_native(JSON.stringify({"type": "DEBUG", "msg": "RESPAWNED at safe pos"}))
		RNBridge.sync_full_state()

func collect_weapon(weapon_name: String, weapon_ammo: int) -> void:
	if weapon_name not in _weapons_collected:
		_weapons_collected.append(weapon_name)
	weapon = weapon_name
	ammo += weapon_ammo
	_weapon_index = _weapons_collected.find(weapon_name)
	RNBridge.on_item_picked_up(weapon_name, {"weapon": weapon_name, "ammo": ammo})

func collect_potion() -> void:
	potions += 1
	RNBridge.on_item_picked_up("potion", {"potions": potions})

# ── State Export (for RNBridge.sync_full_state) ──────────────────────────────

func get_state() -> Dictionary:
	return {
		"health": health,
		"weapon": weapon,
		"ammo": ammo,
		"potions": potions,
		"position": {
			"x": global_position.x,
			"y": global_position.y,
			"z": global_position.z
		}
	}
