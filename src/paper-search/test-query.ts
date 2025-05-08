import { queryPapers } from './utils'

async function testSearch() {
  try {
    console.log('Testing paper search...')
    const results = await queryPapers('emotional responses in decision making', 5)

    console.log(`Found ${results.length} results:\n`)
    results.forEach((result, index) => {
      console.log(`Result ${index + 1}:`)
      console.log(`File: ${result.paperFileName || 'Unknown'}`)
      console.log(`Similarity Score: ${result.similarity.toFixed(4)}`)
      console.log(`Text Preview: "${result.chunkText.substring(0, 200)}..."\n`)
    })
  } catch (error) {
    console.error('Search test failed:', error)
  }
}

testSearch().catch(console.error)
