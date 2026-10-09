# Drivstoffapp

iPhone-app (SwiftUI + SwiftData) for å holde oversikt over drivstoffutgifter for flere biler.

## Funksjoner

- **Biler**: legg inn biler med navn, registreringsnummer og standard drivstoff (bensin/diesel).
- **Fyllinger**: dato, antall liter, totalpris, kilometerstand, bil (nedtrekksmeny), drivstofftype, stasjon og notat.
  Literpris beregnes automatisk fra totalpris ÷ liter.
- **Skann kvittering**: Apples dokumentskanner finner kvitteringen, retter opp perspektivet og
  tekstgjenkjenning (Vision, kjører lokalt på telefonen) fyller ut liter, beløp, drivstofftype, dato og stasjon.
  Du kan også velge et bilde fra Bilder. Alle felt kan rettes før lagring.
- **Kvittering som PDF**: kvitteringen lagres som PDF på fyllingen og kan vises og deles/eksporteres (Filer, e-post, AirDrop).
- **Manuell registrering**: alt kan fylles inn for hånd uten kvittering.
- **Statistikk**: totalkostnad, liter, snitt literpris, forbruk (liter per mil), kostnad per km og månedsgraf per bil.
- Advarsel hvis kilometerstanden er lavere enn ved forrige fylling.

## Kom i gang

Krever en Mac med **Xcode 16** eller nyere. Appen krever **iOS 17**.

1. Åpne `Drivstoffapp.xcodeproj` i Xcode.
2. Velg target **Drivstoffapp → Signing & Capabilities** og velg ditt Team (en gratis Apple-ID holder for egen telefon).
   Endre ev. *Bundle Identifier* hvis `no.lilleseth.Drivstoffapp` er opptatt.
3. Koble til iPhonen og trykk ▶︎ (Run). Første gang må du godkjenne utvikleren på telefonen under
   *Innstillinger → Generelt → VPN og enhetsadministrasjon*.

Skanneren krever ekte kamera – i simulatoren kan du bruke «Velg bilde av kvittering» i stedet.

Kjør enhetstestene med ⌘U.

## Struktur

```
Drivstoffapp/
  Models/      Car, FillUp (SwiftData), FuelType, Statistics
  Receipt/     DocumentScannerView (VisionKit), TextRecognizer (Vision OCR),
               ReceiptParser (tolker norske kvitteringer), PDFBuilder
  Views/       Fyllinger, registreringsskjema, biler, statistikk, PDF-visning
  Util/        Formatering og tall-tolking (komma/punktum)
DrivstoffappTests/  Tester for kvitteringsparser, talltolking og statistikk
```

## Om kvitteringstolkingen

`ReceiptParser` ser etter typiske mønstre på norske kvitteringer (Circle K, Uno-X, Esso, Shell, YX, St1 m.fl.), f.eks.
`42,31 l x 21,49 kr/l`, `Liter: 35,50`, `Pris pr. liter`, `Total`/`Sum`/`Å betale`/`Beløp`, og datoer som
`05.10.2026 14:32` eller `2026-08-15`. Den kryssjekker liter × literpris mot totalbeløpet og regner ut
manglende verdier. Kilometerstand står ikke på kvitteringer og må alltid fylles inn manuelt.

Treffer den feil på en kvittering: åpne «Gjenkjent tekst» i skjemaet, og legg teksten til som en ny test i
`DrivstoffappTests/ReceiptParserTests.swift`.
