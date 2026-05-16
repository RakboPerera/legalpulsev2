export function clusterClients(clients) {
  const groups = {};
  for (const c of clients) {
    const key = `${c.sector || 'other'}::${c.size || 'mid'}`;
    if (!groups[key]) groups[key] = { key, sector: c.sector, size: c.size, members: [] };
    groups[key].members.push(c.id);
  }
  return Object.values(groups);
}

export function servicesByClient(matters) {
  const map = new Map();
  for (const m of matters) {
    if (!map.has(m.client)) map.set(m.client, new Set());
    (m.services || []).forEach(s => map.get(m.client).add(s));
  }
  return map;
}

export function buildClientServiceMatrix(clients, matters) {
  const matrix = {};
  for (const c of clients) matrix[c.id] = new Set();
  for (const m of matters) {
    if (!matrix[m.client]) matrix[m.client] = new Set();
    (m.services || []).forEach(s => matrix[m.client].add(s));
  }
  Object.keys(matrix).forEach(k => { matrix[k] = Array.from(matrix[k]); });
  return matrix;
}

export function findServiceGaps(clientId, matrix, cluster) {
  const peers = cluster.members.filter(m => m !== clientId);
  if (peers.length === 0) return [];
  const peerServices = new Map();
  for (const peer of peers) {
    for (const svc of (matrix[peer] || [])) {
      peerServices.set(svc, (peerServices.get(svc) || 0) + 1);
    }
  }
  const ownServices = new Set(matrix[clientId] || []);
  const gaps = [];
  for (const [svc, count] of peerServices) {
    if (!ownServices.has(svc)) {
      gaps.push({
        service: svc,
        peersUsingService: count,
        peerCount: peers.length,
        penetration: count / peers.length
      });
    }
  }
  return gaps.sort((a, b) => b.penetration - a.penetration);
}
