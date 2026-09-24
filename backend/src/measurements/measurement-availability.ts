// Published catalogs and stored records preserve history. Availability
// controls new entries independently, including requests using older catalogs.
export function measurementUnavailabilityReason(code: string) {
  return code === 'self_curl_up' ? 'official_criteria_unverified' : null;
}
