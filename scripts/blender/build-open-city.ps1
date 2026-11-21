param(
    [string]$Blender = "blender",
    [string]$Harness = "cli-anything-blender"
)

$ErrorActionPreference = "Stop"
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("parkline-city-" + [guid]::NewGuid())
$project = "$scratch.blend-cli.json"
$bootstrap = "$scratch.py"
$previousPythonEncoding = $env:PYTHONIOENCODING

function Invoke-Harness {
    $output = & $Harness --json @args
    if ($LASTEXITCODE -ne 0) {
        throw "CLI-Anything Blender failed ($LASTEXITCODE) for $args. $output"
    }
    $output
}

try {
    $env:PYTHONIOENCODING = "utf-8"
    Invoke-Harness scene new --name "Parkline Open City" --output $project | Out-Null
    Invoke-Harness --project $project object add cube --name "City Ground" "--location=0,-4,-2.16" "--scale=128,104,2" | Out-Null

    $avenues = -99, -33, 33, 99
    $streets = -91, -31, 29, 89
    foreach ($y in $streets) {
        Invoke-Harness --project $project object add cube --name "Street $y" "--location=0,$y,-0.11" "--scale=106,7,0.11" | Out-Null
    }
    foreach ($x in $avenues) {
        for ($segment = 0; $segment -lt 3; $segment++) {
            $y = ($streets[$segment] + $streets[$segment + 1]) / 2
            Invoke-Harness --project $project object add cube --name "Avenue $x segment $segment" "--location=$x,$y,-0.11" "--scale=7,23,0.11" | Out-Null
        }
    }
    Invoke-Harness --project $project camera add --name "City overview" --type ORTHO --active | Out-Null
    Invoke-Harness --project $project light add sun --name "Bay sunlight" --power 2.65 | Out-Null
    $generated = @(Invoke-Harness --project $project render script "$scratch.png")
    $render = [Array]::IndexOf($generated, "bpy.ops.render.render(write_still=True)")
    if ($render -lt 1) {
        throw "CLI-Anything did not emit the expected Blender scene script"
    }
    [IO.File]::WriteAllLines($bootstrap, [string[]]$generated[0..($render - 1)])

    $detail = Join-Path $PSScriptRoot "open_city.py"
    & $Blender --background --factory-startup --python-exit-code 1 --python $bootstrap --python $detail --python-expr "import bpy; bpy.ops.render.render(write_still=True)"
    if ($LASTEXITCODE -ne 0) {
        throw "Blender exited with code $LASTEXITCODE"
    }
}
finally {
    $env:PYTHONIOENCODING = $previousPythonEncoding
    foreach ($file in ($project, $bootstrap)) {
        if (Test-Path -LiteralPath $file) {
            Remove-Item -LiteralPath $file
        }
    }
}
