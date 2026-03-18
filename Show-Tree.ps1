param(
    [string]$Path = ".",
    [string[]]$Exclude = @("node_modules", ".fingerprint", "build", "incremental", "deps", ".git","target","icons")
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Show-Tree {
    param(
        [string]$Path,
        [string[]]$Exclude,
        [string]$Prefix = ""
    )

    $items = Get-ChildItem -LiteralPath $Path | Where-Object {
        -not ($Exclude -contains $_.Name)
    }

    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items[$i]
        $isLast = ($i -eq $items.Count - 1)

        if ($isLast) {
            $connector = "└─ "
            $newPrefix = $Prefix + "   "
        } else {
            $connector = "├─ "
            $newPrefix = $Prefix + "│  "
        }

        Write-Output ("{0}{1}{2}" -f $Prefix, $connector, $item.Name)

        if ($item.PSIsContainer) {
            Show-Tree -Path $item.FullName -Exclude $Exclude -Prefix $newPrefix
        }
    }
}

Show-Tree -Path $Path -Exclude $Exclude

Read-Host "続行するには Enter を押してください"