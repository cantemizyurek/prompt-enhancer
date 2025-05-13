import { pipeline } from '@huggingface/transformers'

interface EmbeddingOutput {
  data: number[]
}

type FeatureExtractionPipeline = (text: string) => Promise<EmbeddingOutput>

const MODEL_ID = 'Snowflake/snowflake-arctic-embed-l'
let embeddingModel: FeatureExtractionPipeline | null = null

initializeModel()

async function initializeModel() {
  try {
    console.log('Loading Snowflake Arctic Embed model...')
    const model = await pipeline('feature-extraction', MODEL_ID)
    embeddingModel = model as unknown as FeatureExtractionPipeline
    console.log('Model loaded successfully')
  } catch (error) {
    console.error('Error loading model:', error)
    throw error
  }
}
