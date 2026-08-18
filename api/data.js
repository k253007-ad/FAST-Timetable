import { sheetData } from './sheetConfig.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.status(200).json(sheetData);
}
