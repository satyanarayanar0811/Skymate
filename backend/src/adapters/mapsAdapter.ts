export interface MapsAdapter { routeUrl(fromCode:string,toCode:string):string }
export class OpenStreetMapAdapter implements MapsAdapter { routeUrl(fromCode:string,toCode:string){const a=encodeURIComponent(fromCode),b=encodeURIComponent(toCode);return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${a}%3B${b}`} }
export function createMapsAdapter():MapsAdapter{return new OpenStreetMapAdapter()}
