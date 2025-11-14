import axios from 'axios';
import * as cheerio from 'cheerio';

export interface SalaryChange {
  name: string;
  change: number;
}

export async function fetchSalaryChanges(): Promise<SalaryChange[]> {
  try {
    const response = await axios.get('https://www.linestarapp.com/SalaryChanges/Sport/NBA/Site/DraftKings');
    const $ = cheerio.load(response.data);
    
    const salaryChanges: SalaryChange[] = [];

    $('table.table-striped tbody tr').each((_, element) => {
      const name = $(element).find('td:nth-child(2)').text().trim();
      const changeText = $(element).find('td:nth-child(4)').text().trim();
      const change = parseInt(changeText.replace('$', '').replace(',', ''));

      salaryChanges.push({ name, change });
    });

    return salaryChanges;
  } catch (error) {
    console.error('Error fetching salary changes:', error);
    throw new Error('Failed to fetch salary changes');
  }
}

