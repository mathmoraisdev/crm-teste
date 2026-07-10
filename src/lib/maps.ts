/**
 * URL de busca do Google Maps para um endereço em texto livre. Abre o app/site
 * de mapas já pesquisando o endereço (sem depender de lat/long cadastrada).
 */
export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
