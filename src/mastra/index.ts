import { Mastra } from '@mastra/core'
import { promptEnhancerAgent } from './agents'

export const mastra = new Mastra({
  agents: {
    promptEnhancerAgent
  }
})
