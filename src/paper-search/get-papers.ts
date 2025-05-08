import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import axios from 'axios'
import { parseStringPromise } from 'xml2js'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

const PAPERS_DIR = path.join(process.cwd(), 'data', 'papers')
const ARXIV_API_URL = 'http://export.arxiv.org/api/query'
const MAX_RESULTS = 100
const SEARCH_QUERY = 'all:prompt engineering OR "prompt engineering" OR "large language model prompting"'

interface ArxivEntry {
  id: string[]
  title: string[]
  summary: string[]
  published: string[]
  link: Array<{
    $: {
      href: string
      rel: string
      type: string
    }
  }>
  author: Array<{
    name: string[]
  }>
  [key: string]: unknown
}

/**
 * Search ArXiv for papers related to prompt engineering
 */
async function searchArxiv(query: string, maxResults: number): Promise<ArxivEntry[]> {
  console.log(`Searching ArXiv for: ${query}`)
  console.log(`Fetching up to ${maxResults} results...`)

  try {
    const response = await axios.get(ARXIV_API_URL, {
      params: {
        search_query: query,
        max_results: maxResults,
        sortBy: 'relevance',
        sortOrder: 'descending'
      }
    })

    const result = await parseStringPromise(response.data)
    const entries = result.feed.entry || []

    console.log(`Found ${entries.length} papers matching the query.`)
    return entries
  } catch (error) {
    console.error('Error searching ArXiv:', error instanceof Error ? error.message : error)
    return []
  }
}

/**
 * Downloads a PDF from ArXiv and saves it to the specified directory
 */
async function downloadPaper(entry: ArxivEntry, targetDir: string): Promise<string | null> {
  const pdfLink =
    entry.link.find((link) => link.$.rel === 'related' && link.$.type === 'application/pdf') ||
    entry.link.find((link) => link.$.type === 'application/pdf')

  if (!pdfLink) {
    console.error('PDF link not found for paper:', entry.title[0])
    return null
  }

  const arxivId = entry.id[0].split('/').pop()?.split('v')[0] || 'unknown'
  const fileName = `${arxivId}-${entry.title[0]
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50)}.pdf`
  const filePath = path.join(targetDir, fileName)

  console.log(`Downloading: ${entry.title[0].substring(0, 50)}...`)
  console.log(`URL: ${pdfLink.$.href}`)

  try {
    const response = await axios({
      method: 'get',
      url: pdfLink.$.href,
      responseType: 'stream'
    })

    await pipeline(response.data, createWriteStream(filePath))
    console.log(`✓ Saved to ${fileName}`)
    return fileName
  } catch (error) {
    console.error(`Error downloading ${entry.title[0]}:`, error instanceof Error ? error.message : error)
    return null
  }
}

async function ensureDirectoryExists(dir: string): Promise<void> {
  try {
    await fs.access(dir)
  } catch (error) {
    console.log(`Creating directory: ${dir}`)
    await fs.mkdir(dir, { recursive: true })
  }
}

/**
 * Main function to fetch and download papers
 */
async function fetchPapers(): Promise<void> {
  console.log('Starting ArXiv paper fetch process...')

  await ensureDirectoryExists(PAPERS_DIR)

  const entries = await searchArxiv(SEARCH_QUERY, MAX_RESULTS)
  if (entries.length === 0) {
    console.log('No papers found matching the search criteria.')
    return
  }

  console.log(`Downloading ${entries.length} papers...`)

  const existingFiles = await fs.readdir(PAPERS_DIR)
  let downloadCount = 0

  for (const entry of entries) {
    // Check if we already have papers from this author to avoid duplicates
    const arxivId = entry.id[0].split('/').pop()?.split('v')[0] || ''
    const alreadyExists = existingFiles.some((file) => file.includes(arxivId))

    if (alreadyExists) {
      console.log(`Skipping ${entry.title[0]} (already exists)`)
      continue
    }

    const fileName = await downloadPaper(entry, PAPERS_DIR)
    if (fileName) {
      downloadCount++
      existingFiles.push(fileName) // Add to our tracking list

      // Delay between downloads to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  console.log(`Download process complete. Downloaded ${downloadCount} new papers.`)
}

// Run the script
fetchPapers()
  .then(() => {
    console.log('Paper fetch process completed successfully.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Paper fetch process failed:', err)
    process.exit(1)
  })
