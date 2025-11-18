import { SearchResultImage, SearchResultItem, SearchResults } from '@/lib/types'
import { sanitizeUrl } from '@/lib/utils'

import { BaseSearchProvider } from './base'

type DiffbotWebSearchRequest = {
  text: string
  size?: number
  search_depth?: 'basic' | 'advanced'
  include_domains?: string[]
  exclude_domains?: string[]
}

interface DiffbotWebSearchResponse {
  text?: string
  query?: string | string[]
  results?: DiffbotWebSearchResult[]
  data?: DiffbotWebSearchResult[]
  search_results?: DiffbotWebSearchResult[]
  total_results?: number
  num_results?: number
}

type DiffbotWebSearchImage = string | { url?: string }

interface DiffbotWebSearchResult {
  title?: string
  url?: string
  pageUrl?: string
  page_url?: string
  page?: {
    title?: string
    url?: string
  }
  snippet?: string
  summary?: string
  text?: string
  content?: string
  description?: string
  image_url?: string
  imageUrl?: string
  image?: DiffbotWebSearchImage
  images?: DiffbotWebSearchImage[]
}

export class DiffbotSearchProvider extends BaseSearchProvider {
  private readonly endpoint =
    process.env.DIFFBOT_WEB_SEARCH_URL ??
    'https://llm.diffbot.com/api/v1/web_search'

  async search(
    query: string,
    maxResults: number,
    searchDepth: 'basic' | 'advanced',
    includeDomains: string[],
    excludeDomains: string[]
  ): Promise<SearchResults> {
    const apiKey = process.env.DIFFBOT_API_KEY
    this.validateApiKey(apiKey, 'DIFFBOT')

    const payload: DiffbotWebSearchRequest = { text: query }

    if (maxResults && Number.isFinite(maxResults)) {
      payload.size = Math.max(maxResults, 5)
    }

    payload.search_depth = searchDepth
    if (includeDomains.length) {
      payload.include_domains = includeDomains
    }

    if (excludeDomains.length) {
      payload.exclude_domains = excludeDomains
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(
        `Diffbot API error: ${response.status} ${response.statusText}`
      )
    }

    const data = (await response.json()) as DiffbotWebSearchResponse
    const rawResults =
      data.results ?? data.data ?? data.search_results ?? []

    const results = rawResults
      .map(this.normalizeResult)
      .filter((result): result is SearchResultItem => result !== null)

    const images = this.extractImages(rawResults)

    return {
      query: this.resolveQuery(data, query),
      number_of_results:
        data.total_results ??
        data.num_results ??
        (Array.isArray(data.search_results)
          ? data.search_results.length
          : results.length),
      results,
      images
    }
  }

  private resolveQuery(
    data: DiffbotWebSearchResponse,
    fallback: string
  ): string {
    if (typeof data.text === 'string' && data.text.trim() !== '') {
      return data.text
    }

    if (typeof data.query === 'string' && data.query.trim() !== '') {
      return data.query
    }

    if (Array.isArray(data.query)) {
      const joined = data.query.join(' ').trim()
      if (joined !== '') {
        return joined
      }
    }

    return fallback
  }

  private normalizeResult(result: DiffbotWebSearchResult): SearchResultItem | null {
    const urlCandidate =
      result.url ??
      result.pageUrl ??
      result.page_url ??
      result.page?.url

    if (!urlCandidate) {
      return null
    }

    const title =
      result.title ??
      result.page?.title ??
      result.pageUrl ??
      result.url ??
      'Untitled result'

    const content =
      result.summary ??
      result.snippet ??
      result.text ??
      result.content ??
      result.description ??
      ''

    return {
      title,
      url: sanitizeUrl(urlCandidate),
      content
    }
  }

  private extractImages(results: DiffbotWebSearchResult[]): SearchResultImage[] {
    const images: SearchResultImage[] = []

    for (const result of results) {
      this.collectImagesFromValue(result.images, images)
      this.collectImagesFromValue(result.image, images)

      const primaryImage = result.image_url ?? result.imageUrl
      if (primaryImage && primaryImage.trim() !== '') {
        images.push(sanitizeUrl(primaryImage))
      }
    }

    return images
  }

  private collectImagesFromValue(
    value: DiffbotWebSearchImage | DiffbotWebSearchImage[] | undefined,
    images: SearchResultImage[]
  ) {
    if (!value) {
      return
    }

    const handleSingle = (candidate: DiffbotWebSearchImage) => {
      if (typeof candidate === 'string') {
        if (candidate.trim() !== '') {
          images.push(sanitizeUrl(candidate))
        }
        return
      }

      if (
        candidate &&
        typeof candidate === 'object' &&
        typeof candidate.url === 'string' &&
        candidate.url.trim() !== ''
      ) {
        images.push(sanitizeUrl(candidate.url))
      }
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        handleSingle(entry)
      }
      return
    }

    handleSingle(value)
  }
}
