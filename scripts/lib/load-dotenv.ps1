# Parses a dotenv file WITHOUT executing it and returns the entries as a
# hashtable. Kept behaviourally aligned with scripts/lib/load-dotenv.sh:
# supports `KEY=value`, `export KEY=value`, blank lines, `#` comment lines, one
# layer of matching surrounding single/double quotes, and skips keys that are
# not valid environment-variable identifiers.
function Read-DotenvFile {
  param([Parameter(Mandatory = $true)][string] $Path)

  $result = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $result
  }

  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trimmed = $Line.Trim()
    if ($Trimmed.Length -eq 0 -or $Trimmed.StartsWith('#')) {
      continue
    }

    # Drop an optional leading `export `.
    if ($Trimmed.StartsWith('export ')) {
      $Trimmed = $Trimmed.Substring(7).TrimStart()
    }

    $Parts = $Trimmed -split '=', 2
    if ($Parts.Length -ne 2) {
      continue
    }

    $Key = $Parts[0].Trim()
    # Skip anything that is not a valid environment-variable identifier.
    if ($Key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      continue
    }

    $Value = $Parts[1].Trim()
    # Strip one layer of matching surrounding quotes, if present.
    if (
      $Value.Length -ge 2 -and (
        ($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
        ($Value.StartsWith("'") -and $Value.EndsWith("'"))
      )
    ) {
      $Value = $Value.Substring(1, $Value.Length - 2)
    }

    $result[$Key] = $Value
  }

  return $result
}

# Parses a dotenv file and exports every entry into the current process
# environment. Mirrors `load_dotenv` in scripts/lib/load-dotenv.sh.
function Import-Dotenv {
  param([Parameter(Mandatory = $true)][string] $Path)

  foreach ($Entry in (Read-DotenvFile -Path $Path).GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($Entry.Key, $Entry.Value, 'Process')
  }
}
