import { freigabeHandelnde } from '../../../services/share.service'
import { gastZugriff } from '../../../utils/gast'

/** Rechte und Herkunft des Links – für Unterseiten, ohne den Aufrufzähler zu erhöhen. */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const handelnde = await freigabeHandelnde(umfang)
  return {
    recht: umfang.link.permission,
    erstelltVon: handelnde.name,
    wurzel: umfang.wurzel,
  }
})
