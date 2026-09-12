import type { DifferentiationLevel, DifferenzierungProfil, VariantKind } from '#shared/types/domain'
import { DIFFERENZIERUNG_PROFILE } from '#shared/types/domain'
import { differenzierungProfile } from '#shared/utils/labels'
import { appError } from '../../../utils/errors'

export interface DifferenzierungProfilSpec {
  id: DifferenzierungProfil
  label: string
  description: string
  variantKind: VariantKind
  differentiationLevel: DifferentiationLevel
  /** Zusätzliche Anweisungen für das Sprachmodell. */
  promptRules: string
}

export const DIFFERENZIERUNG_PROFIL_SPECS: Record<DifferenzierungProfil, DifferenzierungProfilSpec> = {
  leichte_sprache: {
    id: 'leichte_sprache',
    label: differenzierungProfile.label('leichte_sprache'),
    description: differenzierungProfile.map.leichte_sprache.description ?? '',
    variantKind: 'differenzierung',
    differentiationLevel: 'grundlegend',
    promptRules: `Schreibe in Leichter Sprache – das ist ein eigenes Register, nicht bloß „einfaches Deutsch“.
- Kurze Sätze. Ein Gedanke pro Satz.
- Keine Metaphern, keine Ironie, keine Schachtelsätze.
- Schwere oder fachliche Wörter im Glossar erklären. Im Aufgabentext möglichst Alltagswörter nutzen.
- Fachinhalte dürfen nicht falsch oder ungenau werden. Wenn ein Fachwort nötig ist, behalte es und erkläre es.
- Bilder nicht neu erfinden: verweise mit „Abbildung wie im Original“.`,
  },
  grundlegend: {
    id: 'grundlegend',
    label: differenzierungProfile.label('grundlegend'),
    description: differenzierungProfile.map.grundlegend.description ?? '',
    variantKind: 'differenzierung',
    differentiationLevel: 'grundlegend',
    promptRules: `Erzeuge eine grundlegendere Fassung derselben Aufgaben.
- Kürzere Arbeitsaufträge, klare Operatoren (nenne, beschreibe, ordne zu).
- Weniger Teilaufgaben, wenn das Original überladen ist. Den Kern des Themas behalten.
- Keine neuen Fachinhalte erfinden.
- Bilder: „Abbildung wie im Original“.`,
  },
  unterstuetzung: {
    id: 'unterstuetzung',
    label: differenzierungProfile.label('unterstuetzung'),
    description: differenzierungProfile.map.unterstuetzung.description ?? '',
    variantKind: 'differenzierung',
    differentiationLevel: 'grundlegend',
    promptRules: `Erzeuge dieselbe Aufgabenfolge mit Unterstützung.
- Wortspeicher (wichtige Wörter zum Ankreuzen oder Einsetzen).
- Satzanfänge oder Lückensätze, wo sonst frei geschrieben werden muss.
- Weniger Schreibaufwand, gleicher fachlicher Kern.
- Bilder: „Abbildung wie im Original“.`,
  },
  erweitert: {
    id: 'erweitert',
    label: differenzierungProfile.label('erweitert'),
    description: differenzierungProfile.map.erweitert.description ?? '',
    variantKind: 'differenzierung',
    differentiationLevel: 'erweitert',
    promptRules: `Erzeuge eine erweiterte Fassung.
- Die Originalaufgaben bleiben erkennbar.
- Ergänze eine Transfer- oder Extraaufgabe, die dasselbe Thema vertieft.
- Keine fachlich falschen Zusätze.
- Bilder: „Abbildung wie im Original“.`,
  },
}

export function isDifferenzierungProfil(value: string): value is DifferenzierungProfil {
  return (DIFFERENZIERUNG_PROFILE as readonly string[]).includes(value)
}

export function requireDifferenzierungProfil(value: string): DifferenzierungProfilSpec {
  if (!isDifferenzierungProfil(value)) {
    throw appError('UNGUELTIGE_EINGABE', 'Bitte ein gültiges Differenzierungsprofil wählen.')
  }
  return DIFFERENZIERUNG_PROFIL_SPECS[value]
}
