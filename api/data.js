import { getSheetData } from './sheetConfig.js';

export default async function handler(req, res) {
  try {
    const data = await getSheetData();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
