import { fetchExternal } from '../lib/http.js';
import { signalId } from '../lib/ids.js';

export async function fetchCompaniesHouseFilings(companyNumber, { entityName } = {}) {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key || !companyNumber) return [];
  const auth = Buffer.from(`${key}:`).toString('base64');
  const url = `https://api.company-information.service.gov.uk/company/${companyNumber}/filing-history?items_per_page=25`;
  const data = await fetchExternal({
    source: 'companies_house',
    url,
    headers: { 'Authorization': `Basic ${auth}` },
    responseType: 'json',
    maxRetries: 2
  });
  if (!data || !Array.isArray(data.items)) return [];
  return data.items.map(item => {
    const link = `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history/${item.transaction_id || ''}`;
    return {
      id: signalId(entityName || companyNumber, 'companies_house', link, item.date || ''),
      source: 'companies_house',
      sourceUrl: link,
      ingestionTimestamp: new Date().toISOString(),
      publishedAt: item.date || new Date().toISOString(),
      title: item.description || item.category || 'Filing',
      description: item.category,
      entities: [{ entityType: 'unknown', mentionedAs: entityName || companyNumber, confidence: 1.0 }],
      jurisdictions: ['UK'],
      rawMetadata: { type: item.type, category: item.category }
    };
  });
}

export async function fetchCompaniesHouseOfficers(companyNumber, { entityName, monthsBack = 12 } = {}) {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key || !companyNumber) return [];
  const auth = Buffer.from(`${key}:`).toString('base64');
  // Use the full filing-set; the default ordering puts most recently
  // appointed first. We need both appointments AND resignations, so we
  // pull a wider page than the previous 15.
  const url = `https://api.company-information.service.gov.uk/company/${companyNumber}/officers?items_per_page=35&order_by=-appointed_on`;
  const data = await fetchExternal({
    source: 'companies_house',
    url,
    headers: { 'Authorization': `Basic ${auth}` },
    responseType: 'json',
    maxRetries: 2
  });
  if (!data || !Array.isArray(data.items)) return [];

  // The previous role-regex filter (/legal|general counsel|compliance/) was
  // a no-op because CH `officer_role` values are an enum: director,
  // corporate-director, secretary, llp-member, etc. UK PLCs do not register
  // their General Counsel as a CH officer — GC departures genuinely don't
  // surface here. What DOES surface is governance churn (director and
  // secretary appointments + resignations), which is itself a strong BD
  // signal (new chair → strategic review; mass resignations → restructuring
  // / audit dispute). Capture both event types over the recency window and
  // let the LLM classifier triage downstream.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffMs = cutoff.getTime();
  function recentEnough(dateStr) {
    if (!dateStr) return false;
    const t = Date.parse(dateStr);
    return !isNaN(t) && t >= cutoffMs;
  }

  const signals = [];
  for (const o of data.items) {
    const role = o.officer_role || 'officer';
    const link = `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/officers`;
    // Resignation event (typically the higher-signal half — a director
    // leaving inside the window often coincides with a public-facing
    // issue, especially when paired with audit/governance news).
    if (recentEnough(o.resigned_on)) {
      signals.push({
        id: signalId(entityName || companyNumber, 'companies_house', `${link}#resigned:${o.name}:${o.resigned_on}`, o.resigned_on),
        source: 'companies_house',
        sourceUrl: link,
        ingestionTimestamp: new Date().toISOString(),
        publishedAt: o.resigned_on,
        title: `${role} resignation — ${o.name} (${entityName || companyNumber})`,
        description: o.occupation ? `Resigned ${role}. Occupation: ${o.occupation}` : `Resigned ${role}.`,
        entities: [{ entityType: 'unknown', mentionedAs: entityName || companyNumber, confidence: 1.0 }],
        jurisdictions: ['UK'],
        rawMetadata: { officer: o.name, role, eventType: 'resignation', resignedOn: o.resigned_on }
      });
    }
    // Appointment event.
    if (recentEnough(o.appointed_on)) {
      signals.push({
        id: signalId(entityName || companyNumber, 'companies_house', `${link}#appointed:${o.name}:${o.appointed_on}`, o.appointed_on),
        source: 'companies_house',
        sourceUrl: link,
        ingestionTimestamp: new Date().toISOString(),
        publishedAt: o.appointed_on,
        title: `${role} appointment — ${o.name} (${entityName || companyNumber})`,
        description: o.occupation ? `Appointed ${role}. Occupation: ${o.occupation}` : `Appointed ${role}.`,
        entities: [{ entityType: 'unknown', mentionedAs: entityName || companyNumber, confidence: 1.0 }],
        jurisdictions: ['UK'],
        rawMetadata: { officer: o.name, role, eventType: 'appointment', appointedOn: o.appointed_on }
      });
    }
  }
  return signals;
}
