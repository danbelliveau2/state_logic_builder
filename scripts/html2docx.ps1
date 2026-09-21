param([string]$Html, [string]$Docx)
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$d = $w.Documents.Open($Html, $false, $true)
$d.SaveAs2($Docx, 16)
$pages = $d.ComputeStatistics(2)
$words = $d.ComputeStatistics(0)
$d.Close($false)
$w.Quit()
Write-Output "saved $Docx pages=$pages words=$words"
