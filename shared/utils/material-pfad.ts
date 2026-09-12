/** Detailroute: Lehrwerke haben eine eigene Hub-Ansicht. */
export function materialPfad(material: { id: string; materialType?: string | null }): string {
  return material.materialType === 'lehrwerk'
    ? `/lehrwerke/${material.id}`
    : `/materialien/${material.id}`
}
