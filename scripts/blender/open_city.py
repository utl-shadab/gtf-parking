"""Build Parkline's static Open City map inside Blender from the CLI-Anything scene."""

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "assets" / "open-city"
GLB = ROOT / "public" / "models" / "city" / "open-city.glb"
AVENUES = (-99, -33, 33, 99)
STREETS = (-91, -31, 29, 89)
RNG = random.Random(412)


def material(name, hex_color, roughness=0.85, metallic=0):
    def linear(byte):
        value = byte / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    color = tuple(linear(int(hex_color[i:i + 2], 16)) for i in (0, 2, 4)) + (1,)
    surface = bpy.data.materials.new(name)
    surface.diffuse_color = color
    surface.use_nodes = True
    shader = surface.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return surface


def collection(name, parent=None):
    group = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(group)
    return group


class Geometry:
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.surfaces = []
        self.materials = []

    def add(self, vertices, faces, surface):
        offset = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(offset + index for index in face) for face in faces)
        if surface not in self.materials:
            self.materials.append(surface)
        self.surfaces.extend([self.materials.index(surface)] * len(faces))

    def box(self, center, size, surface):
        x, y, z = center
        width, depth, height = (length / 2 for length in size)
        vertices = [(x + a * width, y + b * depth, z + c * height)
                    for c in (-1, 1) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        self.add(vertices, ((3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                            (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)), surface)

    def round(self, center, radii, height, surface, sides=12):
        x, y, z = center
        vertices = [(x + radius * math.cos(angle), y + radius * math.sin(angle), z + offset)
                    for radius, offset in zip(radii, (0, height), strict=True)
                    for angle in (i * math.tau / sides for i in range(sides))]
        faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
        faces.extend((i, (i + 1) % sides, (i + 1) % sides + sides, i + sides)
                     for i in range(sides))
        self.add(vertices, faces, surface)

    def mesh(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        for surface in self.materials:
            mesh.materials.append(surface)
        for polygon, index in zip(mesh.polygons, self.surfaces, strict=True):
            polygon.material_index = index
        mesh.update()
        textured = {"Brick", "Roof slate", "Ridge rock", "Ridge grass", "Sand", "Wet sand", "Lawn"}
        if any(surface.name in textured for surface in self.materials):
            uv = mesh.uv_layers.new(name="Surface metres")
            for face in mesh.polygons:
                axis = max(range(3), key=lambda i: abs(face.normal[i]))
                u, v = ((1, 2), (0, 2), (0, 1))[axis]
                for loop_index in face.loop_indices:
                    vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                    uv.data[loop_index].uv = (vertex[u], vertex[v])
        return mesh

    def link(self, name, group):
        obj = bpy.data.objects.new(name, self.mesh(name))
        group.objects.link(obj)
        return obj


P = {name: material(name, color, roughness, metal) for name, color, roughness, metal in (
    ("Asphalt", "343d46", .96, 0), ("Concrete", "c4bbae", .92, 0),
    ("Pavers", "a68d7c", .92, 0), ("Lane white", "f1e9d5", .72, 0),
    ("Lane yellow", "eab862", .72, 0), ("Lawn", "67906d", .96, 0),
    ("Meadow", "799b71", .95, 0), ("Pine green", "356654", .96, 0),
    ("Leaf green", "57876d", .94, 0), ("Olive foliage", "829b61", .96, 0),
    ("Bark", "6e5140", .95, 0), ("Timber", "ac7951", .79, 0),
    ("Ink", "223744", .65, .22), ("Glazing", "3e6479", .27, .16),
    ("Reflective glass", "65869a", .3, .12), ("Warm windows", "ebb37e", .46, 0),
    ("Ivory", "ddd0b6", .86, 0), ("Limestone", "bfa992", .82, 0),
    ("Brick", "aa6654", .86, 0), ("Sage", "8eaa9e", .82, 0),
    ("Roof slate", "635c53", .92, 0), ("Ridge rock", "746955", .95, 0), ("Ridge grass", "849075", .95, 0),
    ("Teal enamel", "2d7c78", .64, .09), ("Coral enamel", "c75e47", .65, .08),
    ("Sand", "ddbc89", .94, 0), ("Wet sand", "ad9d7d", .84, 0),
    ("Sea", "3c8f9c", .28, 0), ("Shallows", "66b3b1", .31, 0), ("Coastal shallows", "66b3b1", .31, 0),
    ("Foam", "c8ded1", .68, 0), ("Signal red", "ec543a", .35, 0),
    ("Signal amber", "ffb946", .36, 0), ("Signal green", "5de18e", .36, 0),
    ("Unlit lamp", "30414a", .65, 0),
)}


def marker(group, name, kind, position, heading=0):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "ARROWS"
    obj.empty_display_size = 1.7
    obj.location = position
    obj.rotation_euler.z = math.radians(heading)
    obj["kind"] = kind
    group.objects.link(obj)
    return obj


def sign(group, name, width, location, background="Ink", freestanding=False):
    x, y, z = location
    board = Geometry()
    board.box((x, y, z), (width, .22, 1.18), P[background])
    if freestanding:
        for side in (-1, 1):
            board.box((x + side * width * .39, y, z / 2), (.16, .16, z), P["Ink"])
    board.link(f"Sign · {name}", group)
    font = bpy.data.curves.new(name, type="FONT")
    font.body, font.align_x, font.align_y, font.size = name, "CENTER", "CENTER", .74
    font.materials.append(P["Lane white"])
    text = bpy.data.objects.new(f"Lettering · {name}", font)
    text.location = (x, y - .123, z)
    text.rotation_euler.x = math.pi / 2
    group.objects.link(text)
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(text.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    lettering = bpy.data.objects.new(text.name + " mesh", mesh)
    lettering.matrix_world = text.matrix_world
    group.objects.link(lettering)
    bpy.data.objects.remove(text, do_unlink=True)
    bpy.data.curves.remove(font)


def roads(group):
    marking = Geometry()
    for axis, roads, junctions in (("x", STREETS, AVENUES), ("y", AVENUES, STREETS)):
        for fixed in roads:
            for left, right in zip(junctions, junctions[1:]):
                for center in range(left + 13, right - 12, 7):
                    dash = (3.1, .19, .018)
                    if axis == "x":
                        marking.box((center, fixed, .02), dash, P["Lane yellow"])
                    else:
                        marking.box((fixed, center, .02), (dash[1], dash[0], dash[2]), P["Lane yellow"])
                for end_point, direction in ((left, 1), (right, -1)):
                    crossing = end_point + direction * 8.15
                    for stripe in range(-6, 7, 2):
                        if axis == "x":
                            marking.box((crossing, fixed + stripe, .02), (2.3, .72, .018), P["Lane white"])
                        else:
                            marking.box((fixed + stripe, crossing, .02), (.72, 2.3, .018), P["Lane white"])
                    stop = end_point + direction * 10.6
                    if axis == "x":
                        marking.box((stop, fixed + direction * 3.35, .02), (.27, 5.7, .018), P["Lane white"])
                    else:
                        marking.box((fixed - direction * 3.35, stop, .02), (5.7, .27, .018), P["Lane white"])
    marking.link("Lane dividers, stop bars and zebra crossings", group)


def streetlights(group):
    lamp = Geometry()
    lamp.round((0, 0, 0), (.26, .22), .23, P["Concrete"], 8)
    lamp.round((0, 0, .23), (.085, .07), 5, P["Ink"], 8)
    lamp.box((0, -.50, 5.16), (.14, 1.12, .14), P["Ink"])
    lamp.box((0, -1.09, 5.09), (.31, .58, .16), P["Ink"])
    lamp.box((0, -1.09, 4.99), (.23, .44, .045), P["Warm windows"])
    mesh = lamp.mesh("Streetlight fixture")
    for y in STREETS:
        for x in (-78, -55, -12, 12, 55, 78):
            obj = bpy.data.objects.new("Streetlight", mesh)
            obj.location = (x, y + 7.9 if y != STREETS[-1] else y - 7.9, .17)
            obj.rotation_euler.z = math.pi if y == STREETS[-1] else 0
            group.objects.link(obj)


def signals(group):
    for x in AVENUES[1:-1]:
        for y in STREETS[1:-1]:
            for dx, dy, rotation, green in ((-1, -1, 0, True), (1, 1, 180, True),
                                             (1, -1, 90, False), (-1, 1, 270, False)):
                g = Geometry()
                g.round((0, 0, 0), (.13, .11), 3.7, P["Ink"], 8)
                g.box((0, -.14, 3.46), (.53, .38, 1.32), P["Ink"])
                for index, color in enumerate(("Signal green", "Signal amber", "Signal red")):
                    lit = (green and index == 0) or (not green and index == 2)
                    g.box((0, -.35, 3.05 + index * .4), (.32, .07, .27),
                          P[color if lit else "Unlit lamp"])
                obj = g.link(f"Traffic signal {x} {y} {rotation:03}", group)
                obj.location = (x + dx * 8.15, y + dy * 8.15, .17)
                obj.rotation_euler.z = math.radians(rotation)
                obj["junction"] = f"{x},{y}"
                obj["approach_degrees"] = rotation


def tower(group, name, xy, dimensions, shell, cap="Ivory", glass="Glazing"):
    x, y = xy
    w, d, floors = dimensions
    base, storey = .22, 3.15
    roof = base + 3.65 + floors * storey
    body = Geometry()
    body.box((x, y, (roof + base) / 2), (w, d, roof - base), P[shell])
    body.box((x, y, 3.35), (w + .35, d + .35, .28), P[cap])
    body.box((x, y, roof + .05), (w + .32, d + .32, .25), P[cap])
    body.box((x, y + d * .13, roof + .68), (w * .48, d * .45, 1.12), P[shell])
    body.box((x, y + d * .13, roof + 1.29), (w * .51, d * .48, .16), P[cap])
    for along_x, length, depth in ((True, w, d), (False, d, w)):
        bays = max(2, int(length / 3.05))
        grid = length / bays
        for side in (-1, 1):
            for bay in range(bays):
                lateral = grid * (bay + .5) - length / 2
                face = side * (depth / 2 + .047)
                wx, wy = (x + lateral, y + face) if along_x else (x + face, y + lateral)
                pane = (grid * .66, .11) if along_x else (.11, grid * .66)
                for floor in range(-1, floors):
                    height = 1.77 if floor < 0 else 5.05 + floor * storey
                    tall = 2.42 if floor < 0 else 1.75
                    shade = "Warm windows" if RNG.random() < .075 else glass
                    frame = (pane[0] + .16, .15) if along_x else (.15, pane[1] + .16)
                    body.box((wx, wy, height), (*frame, tall + .13), P["Ink"])
                    dx, dy = (0, side * .081) if along_x else (side * .081, 0)
                    body.box((wx + dx, wy + dy, height), (*pane, tall), P[shade])
                    mullion = (.061, .045) if along_x else (.045, .061)
                    body.box((wx + dx * 1.8, wy + dy * 1.8, height), (*mullion, tall), P["Ink"])
                    if floor < 0:
                        brow = (grid * .76, .48) if along_x else (.48, grid * .76)
                        body.box((wx + dx * 2, wy + dy * 2, 3.09), (*brow, .10), P[cap])
    body.link(name, group)


def canopy(group, x, y, width, depth, height, surface):
    geo = Geometry()
    geo.box((x, y, height), (width, depth, .42), P[surface])
    geo.box((x, y, height + .24), (width - .28, depth - .24, .12), P["Ivory"])
    for dx in (-1, 1):
        for dy in (-1, 1):
            geo.box((x + dx * (width / 2 - .7), y + dy * (depth / 2 - .65), height / 2),
                    (.24, .24, height), P["Ink"])
    geo.link("Canopy", group)


def commerce(group, markers):
    tower(group, "Restaurant · brick dining room", (-78, -54), (24, 17, 1), "Brick")
    sign(group, "TIDE TABLE", 10, (-78, -62.62, 3.07))
    canopy(group, -78, -64.6, 18, 3.7, 3.13, "Coral enamel")
    tower(group, "Café · corner shop", (-48, -51), (17, 16, 2), "Sage")
    sign(group, "DRIFT CAFE", 8, (-48, -59.12, 3.06), "Teal enamel")
    geo = Geometry()
    for x, y, shade in ((-85, -70, "Ivory"), (-78, -70, "Coral enamel"), (-71, -70, "Ivory"),
                         (-52, -65, "Teal enamel"), (-44, -65, "Ivory")):
        geo.round((x, y, .18), (.075, .07), 2.6, P["Ink"], 8)
        geo.round((x, y, 2.55), (1.5, .2), .49, P[shade], 8)
        geo.round((x, y, .95), (.7, .7), .09, P["Timber"], 8)
        for offset in (-1, 1):
            geo.box((x + offset, y, .52), (.45, .5, .11), P["Ink"])
            geo.box((x + offset, y, .34), (.11, .11, .36), P["Ink"])
    geo.link("Outdoor dining tables and parasols", group)
    marker(markers, "POI · Tide Table restaurant", "restaurant", (-78, -74, .18))
    marker(markers, "POI · Drift Cafe", "cafe", (-48, -67, .18))


def garage(group, markers):
    geo = Geometry()
    for z in (.34, 3.5, 6.67, 9.84):
        geo.box((67, -59, z), (42, 31, .45), P["Concrete"])
        if z > 1:
            geo.box((67, -74.44, z + .36), (42, .18, .62), P["Sage"])
    for x in (47, 56, 67, 78, 87):
        for y in (-73.6, -46.4):
            geo.box((x, y, 5), (.72, .72, 9.6), P["Ivory"])
    for x in range(49, 88, 3):
        geo.box((x, -56, 10.08), (.11, 4.7, .015), P["Lane white"])
    geo.box((84, -59, 4.9), (6, 29, 9.3), P["Ink"])
    geo.add([(59, -84.6, .03), (65, -84.6, .03), (65, -74.5, .565), (59, -74.5, .565)],
            [(0, 1, 2, 3)], P["Asphalt"])
    geo.link("Parkline multi-storey garage", group)
    sign(group, "PARKLINE GARAGE", 14, (67, -74.63, 4.32), "Teal enamel")
    marker(markers, "POI · Parkline Garage", "parking_garage", (67, -81, .18))


def fuel(group, markers):
    tower(group, "Service station shop", (2, -44), (30, 9, 0), "Ivory")
    sign(group, "BAY FUEL", 8.5, (2, -48.62, 3.05), "Coral enamel")
    canopy(group, 1, -65, 30, 13, 4.8, "Teal enamel")
    geo = Geometry()
    for x in (-9, 1, 11):
        geo.box((x, -65, .28), (2.7, 1.5, .2), P["Ivory"])
        geo.box((x, -65, 1.02), (.88, .47, 1.42), P["Coral enamel"])
        geo.box((x, -65.26, 1.31), (.53, .095, .51), P["Ink"])
    geo.link("Fuel pumps and islands", group)
    marker(markers, "POI · Bay Fuel", "fuel_station", (1, -77, .18))
    tower(group, "Shop · Coast Market", (5, -81), (22, 6.5, 0), "Brick")
    sign(group, "COAST MARKET", 9, (5, -84.42, 3.12), "Teal enamel")
    marker(markers, "POI · Coast Market", "shop", (5, -86, .18))


def bench(group, markers, x, y, ground):
    seat = Geometry()
    for i in range(5):
        seat.box((x, y - .237 + i * .112, ground + .46), (2.35, .095, .065), P["Timber"])
    for i in range(4):
        seat.box((x, y + .232 + i * .015, ground + .68 + i * .084), (2.35, .055, .071), P["Timber"])
    for side in (-1, 1):
        leg = x + side * .93
        for depth in (-.19, .20):
            seat.box((leg, y + depth, ground + .21), (.09, .075, .43), P["Ink"])
        seat.box((leg, y + .21, ground + .70), (.085, .076, .55), P["Ink"])
        seat.box((leg, y, ground + .66), (.085, .46, .07), P["Ink"])
    seat.link("Bench · timber and iron", group)
    marker(markers, "Bench seat", "bench", (x, y - .045, ground), 180)


def cottage(group, x, y, shell):
    geo = Geometry()
    half, depth, eaves, ridge = 4.5, 4.25, 3.48, 5.27
    geo.box((x, y, 1.79), (half * 2, depth * 2, 3.24), P[shell])
    for side in (-1, 1):
        front = y + side * depth
        gable = [(x - half, front, eaves), (x + half, front, eaves), (x, front, ridge)]
        geo.add(gable, [(0, 2, 1) if side > 0 else (0, 1, 2)], P[shell])
    for side in (-1, 1):
        edge = x + side * (half + .34)
        rail = [(x, y - depth - .38, ridge), (x, y + depth + .38, ridge),
                (edge, y + depth + .38, eaves - .26), (edge, y - depth - .38, eaves - .26)]
        geo.add(rail, [(0, 3, 2, 1) if side > 0 else (0, 1, 2, 3)], P["Roof slate"])
        geo.box((edge, y, eaves - .30), (.15, depth * 2 + .76, .13), P["Ink"])
    geo.box((x + 2.32, y + 1.42, 4.85), (.65, .69, 1.55), P["Brick"])
    for side in (-1, 1):
        front = y + side * (depth + .035)
        for dx in (-2.52, 2.52):
            geo.box((x + dx, front, 1.97), (1.7, .14, 1.49), P["Ivory"])
            geo.box((x + dx, front + side * .09, 1.97), (1.46, .045, 1.24), P["Glazing"])
            geo.box((x + dx, front + side * .13, 1.97), (.064, .057, 1.25), P["Ivory"])
            geo.box((x + dx, front + side * .18, 1.24), (1.86, .28, .115), P["Limestone"])
    geo.box((x, y - depth - .045, 1.31), (1.3, .17, 2.36), P["Ivory"])
    geo.box((x, y - depth - .15, 1.28), (1.10, .07, 2.15), P["Sage"])
    geo.box((x, y - depth - .42, .28), (2.1, .85, .22), P["Limestone"])
    geo.box((x, y - depth - .80, .192), (2.1, .70, .20), P["Limestone"])
    for dx in (-3.7, 3.7):
        geo.box((x + dx, y - depth - .9, .55), (.49, .48, .57), P["Brick"])
        geo.round((x + dx, y - depth - .9, .82), (.34, .17), .48, P["Leaf green"], 9)
    geo.link("House · Maple Row", group)


def tree_meshes():
    meshes = []
    for index in range(3):
        g = Geometry()
        g.round((0, 0, 0), (.20, .10), 2.7, P["Bark"], 7)
        canopy_shades = ("Leaf green", "Pine green", "Olive foliage")
        for i, (x, y, z, w) in enumerate(((0, 0, 3.5, 1.85), (1.1, .2, 3.25, 1.28),
                                           (-.9, .5, 3.65, 1.49), (.3, -.64, 4.3, 1.25))):
            shade = P[canopy_shades[(i + index) % len(canopy_shades)]]
            g.round((x, y, z - .86), (w * .54, w), .77, shade, 7)
            g.round((x, y, z - .09), (w, w * .49), 1.2, shade, 7)
        meshes.append(g.mesh(f"Broadleaf tree {index + 1}"))
    return meshes


def plant(group, meshes, position, scale):
    tree = bpy.data.objects.new("Tree", RNG.choice(meshes))
    tree.location = position
    tree.scale = (scale,) * 3
    tree.rotation_euler.z = RNG.random() * math.tau
    group.objects.link(tree)


def park_scenery(group, markers, trees):
    park = Geometry()
    park.box((0, -1, .21), (48, 42, .13), P["Lawn"])
    park.box((0, -1, .288), (3.6, 42, .06), P["Pavers"])
    park.box((0, -1, .29), (48, 3.6, .063), P["Pavers"])
    park.round((0, -1, .32), (8.2, 8.2), .055, P["Concrete"], 32)
    park.round((0, -1, .38), (5.7, 5.5), .77, P["Ivory"], 32)
    park.round((0, -1, 1.143), (5.06, 5.06), .025, P["Shallows"], 32)
    park.round((0, -1, 1.14), (1.0, .58), 1.45, P["Ivory"], 16)
    park.round((0, -1, 2.52), (.8, 1.48), .32, P["Ivory"], 16)
    park.round((0, -1, 2.82), (1.25, 1.25), .035, P["Shallows"], 16)
    for x in (-15, 15):
        for y in (-4.6, 2.6):
            bench(group, markers, x, y, .32)
    for x in (-21, -11, 11, 21):
        for y in (-17, -10, 8, 15):
            plant(group, trees, (x + RNG.uniform(-1, 1), y, .29), RNG.uniform(.76, 1.24))
    park.link("Fountain plaza, park paths and benches", group)
    sign(group, "JUNIPER PARK", 9, (-9, -22.7, 1.55), "Teal enamel", freestanding=True)
    marker(markers, "POI · Juniper Park", "park", (0, -20, .29))


def coast(group, markers):
    geo = Geometry()
    geo.box((-93, -116, -.61), (70, 24, 1.64), P["Concrete"])
    geo.box((-93, -127.7, .29), (70, .72, .35), P["Ink"])
    geo.box((34.8, -103.5, .011), (185.5, 5, .32), P["Pavers"])
    geo.box((-93, -113, .25), (35, 12, .095), P["Pavers"])
    for x in range(-122, -61, 9):
        geo.round((x, -125.5, .20), (.24, .20), .74, P["Ink"], 8)
    for i, (w, y, shade) in enumerate(((11, -117, "Coral enamel"), (10, -116, "Teal enamel"),
                                        (9, -120, "Sage"), (7, -122, "Ivory"))):
        x = -114 + i * 14
        geo.box((x, y, 1.48), (w, 3.1, 2.55), P[shade])
        for offset in range(-3, 4):
            geo.box((x + offset * w / 8, y - 1.56, 1.5), (.11, .12, 2.32), P["Ink"])
    geo.link("Harbour quay, cargo and promenade", group)
    sign(group, "BAY HARBOUR", 9, (-80, -107.2, 2.35), "Teal enamel", freestanding=True)
    marker(markers, "POI · Bay Harbour", "harbour", (-80, -108, .22))
    beach_and_pier(group, markers)


def beach_and_pier(group, markers):
    geo = Geometry()
    xs = [-58 + index * 186 / 32 for index in range(33)]

    def contour(y, z, amplitude):
        return [(x, y + amplitude * (math.sin(x / 20) + .31 * math.cos(x / 8)), z) for x in xs]

    def strip(lower, upper, surface):
        count = len(lower)
        geo.add(lower + upper, [(i, i + 1, i + 1 + count, i + count)
                                for i in range(count - 1)], P[surface])

    top = contour(-105.9, .16, 0)
    dry = contour(-126, -.55, 2.3)
    wet = contour(-134, -1.86, 2.7)
    seabed = contour(-153, -3.9, 2.7)
    strip(dry, top, "Sand")
    strip(wet, dry, "Wet sand")
    strip(seabed, wet, "Wet sand")
    edge = contour(-145, -1.21, 2.7)
    strip(edge, contour(-106.1, -1.21, 0), "Coastal shallows")
    strip(contour(-179, -1.21, 0), edge, "Sea")
    geo.box((-93, -153.45, -1.30), (70, 51.1, .18), P["Sea"])
    for y, start, length in ((-136.3, 1, 30), (-142, 0, 27), (-146, 4, 27), (-154, 1, 31)):
        curve = contour(y, -1.197, 2.7)
        for index in range(start, start + length):
            if RNG.random() < .19:
                continue
            a, b = curve[index:index + 2]
            strip([a, b], [(x, by + .21, z) for x, by, z in (a, b)], "Foam")
    geo.link("Beach slope, tide bands and ocean", group)
    pier = Geometry()
    pier.box((69, -138.2, .01), (6, 46.6, .61), P["Timber"])
    pier.box((69, -161.2, .04), (12.6, 7.1, .67), P["Timber"])
    pier.add([(66, -114.9, .315), (72, -114.9, .315), (72, -106, .173), (66, -106, .173)],
             [(0, 1, 2, 3)], P["Timber"])
    for y in range(-160, -114, 4):
        for x in (66.35, 71.65):
            pier.box((x, y, -1.5), (.47, .47, 3.48), P["Ink"])
    for x in (66.13, 71.87):
        pier.box((x, -139, 1.14), (.12, 44, .15), P["Ivory"])
        for y in range(-160, -116, 4):
            pier.box((x, y, .76), (.14, .14, .93), P["Ivory"])
    for y in range(-158, -114, 2):
        pier.box((69, y, .321), (5.78, .065, .024), P["Bark"])
    pier.link("Timber pier and railings", group)
    for x, shade in ((-25, "Teal enamel"), (-9, "Coral enamel"), (9, "Ivory"), (24, "Teal enamel")):
        parasol = Geometry()
        parasol.round((x, -115.6, -.19), (.063, .057), 2.24, P["Timber"], 8)
        parasol.round((x, -115.6, 1.93), (1.72, .16), .62, P[shade], 8)
        parasol.link("Beach parasol", group)
    marker(markers, "POI · Drift Beach", "beach", (4, -114, -.1))
    marker(markers, "POI · Timber Pier", "pier", (69, -157, .38))


def hill_height(x, y):
    distance = max(y - 96, 0)
    fade = min(distance / 20, (188 - y) / 18, (128 - abs(x)) / 22, 1)
    hills = 31 * math.exp(-((x + 65) / 44) ** 2 - ((y - 153) / 29) ** 2)
    hills += 25 * math.exp(-((x - 51) / 52) ** 2 - ((y - 158) / 33) ** 2)
    ridges = 2.8 * math.sin(x * .094 + y * .15) + 1.55 * math.cos(x * .22 - y * .13)
    ridges += .68 * math.sin(x * .43 + y * .29)
    return max(fade, 0) * max(0, hills + ridges)


def ridge_points():
    for i in range(121):
        t = i / 120
        x = -99 + 198 * t * t * (3 - 2 * t)
        y = 96 + 55 * math.sin(math.pi * t) + 12 * math.sin(3 * math.pi * t)
        yield Vector((x, y))


def hills(group, markers, trees):
    terrain = Geometry()
    xs, ys = range(-128, 129, 2), range(96, 189, 2)
    vertices = [(x, y, hill_height(x, y) - .023) for y in ys for x in xs]
    for row in range(len(ys) - 1):
        for column in range(len(xs) - 1):
            start = row * len(xs) + column
            index = (start, start + 1, start + len(xs) + 1, start + len(xs))
            heights = [vertices[i][2] for i in index]
            shade = "Ridge rock" if max(heights) - min(heights) > 2.1 and max(heights) > 7 else "Ridge grass"
            terrain.add([vertices[i] for i in index], [(0, 1, 2), (0, 2, 3)], P[shade])
    terrain.link("Juniper Ridge terrain", group)
    roadway = Geometry()
    points = list(ridge_points())
    profiles = []
    for i, center in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        left = Vector((-tangent.y, tangent.x))
        edge_profile = []
        for offset in (-4.5, -.095, .095, 4.5):
            x, y = center + left * offset
            lifted = .01 + min((y - 96) / 30, 1) * .25
            edge_profile.append((x, y, hill_height(x, y) + lifted))
        profiles.append(edge_profile)
    for i, (start, end) in enumerate(zip(profiles, profiles[1:])):
        for j in range(3):
            surface = "Lane yellow" if j == 1 and i % 4 < 2 else "Asphalt"
            roadway.add([start[j], end[j], end[j + 1], start[j + 1]], [(0, 1, 2, 3)], P[surface])
        if 6 < i < 113 and i % 3 == 0:
            x, y, z = start[-1]
            roadway.box((x, y, z + .31), (.16, .16, .69), P["Ivory"])
    roadway.link("Ridge Drive and roadside bollards", group)
    for x in range(-114, 116, 9):
        for y in range(107, 181, 11):
            tx, ty = x + RNG.uniform(-2.5, 2.5), y + RNG.uniform(-3, 3)
            if min((p.x - tx) ** 2 + (p.y - ty) ** 2 for p in points) > 9 ** 2:
                if RNG.random() < .51:
                    plant(group, trees, (tx, ty, hill_height(tx, ty)), RNG.uniform(.82, 1.65))
    center = points[len(points) // 2]
    marker(markers, "POI · Juniper Ridge", "hills", (*center, hill_height(*center) + .28), 90)


def transit(group, markers):
    guideway = Geometry()
    guideway.box((-116, -5, 5.34), (4.8, 200, .64), P["Concrete"])
    for y in range(-97, 95, 12):
        guideway.box((-116, y, 2.66), (1.8, 1.8, 5.33), P["Ivory"])
    for x in (-117.05, -114.95):
        guideway.box((x, -5, 5.78), (.18, 200, .19), P["Ink"])
    guideway.link("Elevated rail guideway", group)
    for y, name in ((-83, "HARBOUR"), (-4, "CENTRAL"), (76, "JUNIPER")):
        platform = Geometry()
        platform.box((-121, y, 5.51), (5.2, 25, .48), P["Concrete"])
        platform.box((-118.53, y, 5.77), (.27, 25, .026), P["Lane yellow"])
        for step in range(18):
            height = (18 - step) * (5.56 / 18)
            platform.box((-123, y - 12.70 - step * .44, height / 2),
                         (2.4, .46, height), P["Concrete"])
        platform.link(f"{name.title()} rail platform and stairs", group)
        canopy(group, -121.2, y, 4.2, 13, 8.49, "Teal enamel")
        sign(group, name, 5.6, (-121, y - 6.73, 8.1))
        marker(markers, f"Station · {name.title()}", "station", (-116, y, 5.89))
    train = Geometry()
    profile = ((-1.34, 6.14), (1.34, 6.14), (1.59, 6.45), (1.59, 7.79),
               (1.40, 8.14), (1.05, 8.27), (-1.05, 8.27), (-1.40, 8.14),
               (-1.59, 7.79), (-1.59, 6.45))
    count = len(profile)
    for y in (-14, 3.5):
        rows = [(-8.43, .83), (-8, 1), (8, 1), (8.43, .83)]
        rings = [(-116 + x * scale, y + dy, z) for dy, scale in rows for x, z in profile]
        for ring in range(len(rows) - 1):
            for i in range(count):
                j = (i + 1) % count
                polygon = [(ring * count + i, (ring + 1) * count + i, (ring + 1) * count + j, ring * count + j)]
                train.add(rings, polygon, P["Sage" if i in (4, 5, 6) else "Ivory"])
        train.add(rings, [tuple(range(count)), tuple(reversed(range(3 * count, 4 * count)))], P["Ivory"])
        for side in (-1, 1):
            x = -116 + side * 1.603
            train.box((x, y, 6.71), (.055, 16, .34), P["Teal enamel"])
            for dy in (-6.2, -1.05, 1.05, 6.2):
                train.box((x, y + dy, 7.36), (.064, 1.69, .83), P["Ink"])
                train.box((x + side * .046, y + dy, 7.36), (.038, 1.52, .68), P["Glazing"])
            for dy in (-3.67, 3.67):
                train.box((x, y + dy, 7.04), (.087, 1.70, 1.75), P["Ink"])
                for offset in (-.40, .40):
                    train.box((x + side * .053, y + dy + offset, 7.03), (.045, .74, 1.63), P["Sage"])
                    train.box((x + side * .079, y + dy + offset, 7.42), (.027, .57, .63), P["Glazing"])
        for axle in (-5.52, -4.49, 4.49, 5.52):
            for x in (-117.61, -114.39):
                train.box((x, y + axle, 6.02), (.31, .60, .41), P["Ink"])
        for side in (-1, 1):
            end = y + side * 8.465
            train.box((-116, end, 7.48), (2.29, .068, .96), P["Ink"])
            for x in (-116.54, -115.46):
                train.box((x, end + side * .051, 7.49), (1, .042, .79), P["Glazing"])
                train.box((x, end + side * .065, 6.80), (.29, .047, .16), P["Warm windows"])
            train.box((-116, end, 6.43), (1.92, .13, .34), P["Teal enamel"])
        train.box((-116, y + 8.64, 6.32), (.48, .48, .29), P["Ink"])
    train.link("Bay Line train", group)["kind"] = "train_vehicle"
    bus_stops(group, markers)


def bus_stops(group, markers):
    for x, y, name in ((18, -22.6, "JUNIPER PARK"), (78, -99.4, "DRIFT BEACH"),
                       (-77, 37.4, "WEST MARKET")):
        shelter = Geometry()
        shelter.box((x, y, 2.49), (6.1, 2.1, .23), P["Teal enamel"])
        shelter.box((x, y + .82, 1.4), (5.6, .12, 1.92), P["Sage"])
        shelter.box((x, y + .35, .65), (4.7, .57, .17), P["Timber"])
        for dx in (-2.75, 2.75):
            shelter.box((x + dx, y + .77, 1.35), (.17, .17, 2.4), P["Ink"])
        shelter.round((x + 3.75, y, .17), (.083, .083), 2.75, P["Ink"], 8)
        shelter.box((x + 3.75, y, 2.71), (.57, .16, .49), P["Coral enamel"])
        shelter.link(f"Bus shelter · {name.title()}", group)
        marker(markers, f"Bus stop · {name.title()}", "bus_stop", (x, y, .18))


def city_blocks(root, markers, trees):
    names = ("Seafront dining", "Bay Fuel", "Parkline Garage", "West Market", "Juniper Park",
             "Marina Offices", "Maple Row", "Civic Quarter", "Juniper Heights")
    for i, y in enumerate((-61, -1, 59)):
        for j, x in enumerate((-66, 0, 66)):
            group = collection(names[i * 3 + j], root)
            slab = Geometry()
            slab.box((x, y, -.014), (52, 46, .37), P["Concrete"])
            slab.box((x, y, .174), (46, 40, .028), P["Pavers"])
            slab.link("Block foundation and footpaths", group)
            if (i, j) == (0, 0):
                commerce(group, markers)
            elif (i, j) == (0, 1):
                fuel(group, markers)
            elif (i, j) == (0, 2):
                garage(group, markers)
            elif (i, j) == (1, 1):
                park_scenery(group, markers, trees)
            else:
                develop_block(group, x, y)
                for offset in (-19, -7, 7, 19):
                    plant(group, trees, (x + offset, y + 19, .19), RNG.uniform(.75, 1.13))


def develop_block(group, x, y):
    if group.name == "Maple Row":
        for dx in (-16.5, 0, 16.5):
            for dy in (-11, 8):
                cottage(group, x + dx, y + dy, "Brick" if dx == 0 else ("Ivory" if dy > 0 else "Limestone"))
        return
    layouts = {
        (-66, -1): ((-11, -5, 20, 21, 3, "Brick"), (12, 4, 17, 22, 4, "Ivory")),
        (66, -1): ((-12, 2, 19, 25, 9, "Sage"), (11, -4, 18, 22, 6, "Limestone")),
        (0, 59): ((-11, 0, 19, 28, 6, "Limestone"), (11, 3, 18, 21, 8, "Ivory")),
        (66, 59): ((-11, 1, 19, 27, 11, "Glazing"), (11, -4, 17, 19, 8, "Sage")),
    }
    for index, (dx, dy, w, d, floors, shell) in enumerate(layouts[(x, y)], start=1):
        glass = "Reflective glass" if shell in ("Glazing", "Brick") else "Glazing"
        tower(group, f"{group.name} · {index}", (x + dx, y + dy), (w, d, floors), shell, glass=glass)
    if x == -66 and y == -1:
        sign(group, "WEST MARKET", 10, (-77, -16.15, 3.07), "Coral enamel")


def build_city():
    scene = bpy.context.scene
    scene.name = "Parkline · Open City"
    scene.unit_settings.system = "METRIC"
    city = collection("Open City")
    street_group = collection("Street grid", city)
    presentation = collection("Presentation")
    markers = collection("Spawn and destinations", city)
    for obj in list(scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            group = presentation
        else:
            group = street_group
            obj.data.materials.clear()
            obj.data.materials.append(P["Meadow" if obj.name == "City Ground" else "Asphalt"])
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        group.objects.link(obj)
    for group in list(scene.collection.children):
        if not group.objects and not group.children:
            bpy.data.collections.remove(group)
    assert len(street_group.objects) == 17, "Load the CLI-Anything city ground and 16 road segments first"
    roads(street_group)
    streetlights(street_group)
    signals(collection("Traffic lights", city))
    trees = tree_meshes()
    city_blocks(collection("Downtown blocks", city), markers, trees)
    coast(collection("Harbour and beach", city), markers)
    boardwalk = collection("Promenade seating", city)
    for x in (-30, -14, 23, 59):
        bench(boardwalk, markers, x, -103, .23)
    for x in (-27, -12, 19, 36):
        plant(boardwalk, trees, (x, -82.55, .18), RNG.uniform(.76, 1.1))
    hills(collection("Juniper Ridge", city), markers, trees)
    transit(collection("Public transport", city), markers)
    marker(markers, "Spawn · Seafront Boulevard", "vehicle_spawn", (-14, -94.5, .07), -90)
    return city


def deliver(city):
    scene = bpy.context.scene
    camera = scene.camera
    camera.location = (316, -408, 409)
    target = Vector((0, 3, 0))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 438
    camera.data.clip_end = 1500
    sun = bpy.data.objects["Bay sunlight"]
    sun.rotation_euler = (math.radians(29), math.radians(-38), math.radians(-28))
    sun.data.color = (1, .84, .66)
    sun.data.angle = math.radians(8)
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (.39, .53, .69, 1)
    background.inputs["Strength"].default_value = .39
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 20
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1440
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = "//open-city.png"
    scene.view_settings.view_transform = "AgX"

    bpy.ops.object.select_all(action="DESELECT")
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_perspective = "CAMERA"
                area.spaces.active.shading.color_type = "MATERIAL"
                area.spaces.active.overlay.show_overlays = False

    bpy.context.preferences.filepaths.save_version = 0
    OUTPUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "open-city.blend"))
    for obj in city.all_objects:
        obj.select_set(True)
    result = bpy.ops.export_scene.gltf(filepath=str(GLB), use_selection=True, export_extras=True,
                                      export_hierarchy_full_collections=True,
                                      export_gpu_instances=True, export_animations=False,
                                      export_draco_mesh_compression_enable=True)
    assert result == {"FINISHED"} and GLB.stat().st_size > 50_000, "Open City GLB export failed"


deliver(build_city())
