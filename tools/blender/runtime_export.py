"""Export the moving pivots and casting finish for the live desktop renderer."""
import bpy


def export_rig(path, motor, crank, wheels, cams, rods, pistons, valves, springs,
               needle, cover, outlet, pitch, first):
    motor["joint"] = "mount"
    motor["outlet"] = list(outlet)
    motor["pitch"] = pitch
    motor["first"] = first
    for shaft in [crank, *wheels, *cams]:
        shaft["joint"] = "crank" if shaft in (crank, wheels[0]) else "cam"
    for i, (rod, piston) in enumerate(zip(rods, pistons)):
        for obj, joint in [(rod, "rod"), (piston, "piston")]:
            obj["joint"] = joint
            obj["cylinder"] = i
            obj.location.x = first + i*pitch
    for (valve, index, exhaust, _, _), spring in zip(valves, springs):
        for obj, joint in [(valve, "valve"), (spring, "spring")]:
            obj["joint"] = joint
            obj["cylinder"] = index
            obj["port"] = "exhaust" if exhaust else "intake"
    needle["joint"] = "oilPressure"
    for obj in cover.objects:
        obj["removable"] = True
    # glTF supports image maps. Use the viewport metal colour for procedural-only alloys.
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        bs = mat.node_tree.nodes.get('Principled BSDF')
        if not bs:
            continue
        for key in ('Base Color', 'Roughness', 'Normal'):
            socket = bs.inputs[key]
            if socket.is_linked and socket.links[0].from_node.type != 'TEX_IMAGE':
                mat.node_tree.links.remove(socket.links[0])
        if not bs.inputs['Base Color'].is_linked:
            bs.inputs['Base Color'].default_value = mat.diffuse_color
        if not bs.inputs['Roughness'].is_linked:
            bs.inputs['Roughness'].default_value = mat.roughness
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path.resolve()), export_format='GLB',
                              export_yup=False, export_extras=True, export_animations=False,
                              export_apply=True, export_cameras=False, export_lights=False)
