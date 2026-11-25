
import { generateText } from 'ai'
import {
  appFiles,
  createDeepSpaceAI,
} from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import { z } from 'zod'
import type { Env } from '../../worker'

const receiptSchema = z.object({
  productName: z.string(),
  retailer: z.string(),
  purchaseDate: z.string(),
  price: z.number().nullable(),
})

const extractReceipt: ActionHandler<Env> = async ({
  userId,
  params,
  tools,
  env,
  callerJwt,
}) => {
  const fileKey = params.fileKey

  if (typeof fileKey !== 'string' || !fileKey.trim()) {
    return { success: false, error: 'A receipt file key is required.' }
  }

  // Verify that this receipt belongs to the signed-in user.
  const result = await tools.query('attachments', {
    where: { fileKey },
    limit: 1,
  })

  if (!result.success) {
    return { success: false, error: 'Unable to locate the receipt.' }
  }

  const attachment = result.data.records[0]

  if (!attachment || attachment.data.ownerId !== userId) {
    return { success: false, error: 'Receipt not found or access denied.' }
  }

  const mimeType = attachment.data.mimeType
  const fileSize = attachment.data.fileSize
const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
]

if (
  typeof mimeType !== 'string' ||
  !allowedMimeTypes.includes(mimeType)
) {
  return {
    success: false,
    error: 'Please upload a JPEG, PNG, or WebP receipt image.',
  }
}

if (
  typeof fileSize !== 'number' ||
  fileSize <= 0 ||
  fileSize > 10 * 1024 * 1024
) {
  return {
    success: false,
    error: 'The receipt image must be larger than 0 bytes and no bigger than 10 MB.',
  }
}

  try {
    // Download the receipt from the user's private storage.
    const files = appFiles(env, {
      scope: 'self',
      userId,
    })

    const response = await files.download(fileKey)

    if (!response.ok) {
      return { success: false, error: 'Unable to read the receipt file.' }
    }

    const image = new Uint8Array(await response.arrayBuffer())

    // Use DeepSpace's AI proxy with the signed-in user's credentials.
    const model = createDeepSpaceAI(env, 'anthropic', {
      authToken: callerJwt,
    })('claude-sonnet-5-5')

    const aiResponse = await generateText({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract the purchase information from this receipt.

Return ONLY a JSON object with these four fields:
{
  "productName": "string",
  "retailer": "string",
  "purchaseDate": "YYYY-MM-DD",
  "price": number or null
}

Rules:
- Use only information clearly visible on the receipt.
- Never guess, invent, or complete missing information.
- Use an empty string if the retailer, product name, or date cannot be determined.
- Use null if the final total cannot be determined.
- Extract the final total paid, not the subtotal, when clearly shown.
- Do not include currency symbols in the price.
- If the receipt contains multiple purchased items, summarize them briefly rather than copying every item description.
- Preserve recognizable product names and important identifying details.
- Do not include store addresses, payment information, tax details, or unrelated receipt text in productName.
- If some item names are difficult to read, include only the portions that can be read confidently.
- Return valid JSON only, with no Markdown formatting or explanation.`,
            },
            {
              type: 'image',
              image,
              mediaType: mimeType,
            },
          ],
        },
      ],
    })

    // Validate the model's response before returning it.
    const cleanedText = aiResponse.text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

    const parsed = receiptSchema.safeParse(JSON.parse(cleanedText))

    if (!parsed.success) {
      return {
        success: false,
        error: 'The receipt information could not be read reliably.',
      }
    }

    return {
      success: true,
      data: {
        ...parsed.data,
        needsReview: true,
      },
    }
  } catch (error) {
    console.error('Receipt extraction failed:', error)

    return {
      success: false,
      error: 'Receipt extraction failed. Please try again.',
    }
  }
}

export const actions: Record<string, ActionHandler<Env>> = {
  'extract-receipt': extractReceipt,
}
