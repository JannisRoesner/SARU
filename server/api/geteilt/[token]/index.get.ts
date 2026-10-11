import { freigabeHandelnde, markShareUsed } from '../../../services/share.service'
import { gastLehrwerkInhalt, gastMaterial, gastReihe } from '../../../services/share-view.service'
import { gastZugriff } from '../../../utils/gast'

/** Startansicht eines Freigabe-Links. */
export default defineEventHandler(async (event) => {
  const umfang = await gastZugriff(event)
  const handelnde = await freigabeHandelnde(umfang)
  await markShareUsed(umfang.link)

  const basis = {
    recht: umfang.link.permission,
    label: umfang.link.label,
    erstelltVon: handelnde.name,
    laeuftAb: umfang.link.expiresAt?.toISOString() ?? null,
    wurzel: umfang.wurzel,
  }

  if (umfang.wurzel.typ === 'reihe') {
    return { ...basis, reihe: await gastReihe(umfang) }
  }
  const material = await gastMaterial(umfang, umfang.wurzel.id)
  const inhalt =
    umfang.wurzel.materialType === 'lehrwerk' ? await gastLehrwerkInhalt(umfang, umfang.wurzel.id) : null
  return { ...basis, material, inhalt }
})
