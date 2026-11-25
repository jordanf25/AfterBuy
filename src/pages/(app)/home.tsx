import { useState } from 'react'
import { useQuery, useMutations, useR2Files, getAuthToken } from 'deepspace'

type DeadlineSource = 'user' | 'confirmed_policy' | 'unknown'

type Purchase = {
  productName: string
  retailer: string
  price: number
  purchaseDate: string
  receiptFileKey?: string
  returnDeadline?: string
  deadlineSource?: DeadlineSource
  returnWindowDays?: number
}

function getDaysUntilDeadline(deadline: string): number {
  const [year, month, day] = deadline.split('-').map(Number)

  const deadlineDate = Date.UTC(year, month - 1, day)
  const today = new Date()
  const todayDate = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  )

  return Math.round(
    (deadlineDate - todayDate) / (1000 * 60 * 60 * 24)
  )
}

type RadarPurchase = Purchase & {
  recordId: string
  daysRemaining: number
  explanation: string
}

function getRegretRadarItems(purchases: {
  recordId: string
  data: Purchase
}[]): RadarPurchase[] {
  return purchases
    .filter((purchase) => {
      return Boolean(purchase.data.returnDeadline)
    })
    .map((purchase) => {
      const daysRemaining = getDaysUntilDeadline(
        purchase.data.returnDeadline!
      )

      return {
        ...purchase.data,
        recordId: purchase.recordId,
        daysRemaining,
        explanation:
          daysRemaining < 0
            ? `Return deadline passed ${Math.abs(daysRemaining)} days ago.`
            : daysRemaining === 0
              ? 'Return deadline is today.'
              : `Return window closes in ${daysRemaining} days.`,
      }
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
}

type Attachment = {
  fileName: string
  fileKey: string
  mimeType: string
  fileSize: number
}

export default function HomePage() {

  const { records: purchases = [], status, error } = useQuery<Purchase>('purchases')
  const radarItems = getRegretRadarItems(purchases)
  const purchasesWithoutDeadlines = purchases.filter(
  (purchase) => !purchase.data.returnDeadline
  )
  const purchasesProtected = purchases.filter(
  (purchase) => Boolean(purchase.data.returnDeadline)
  ).length
  const { createConfirmed, removeConfirmed, putConfirmed } = useMutations<Purchase>('purchases')
  const { create } = useMutations<Attachment>('attachments')
  const { upload, isUploading, readFile } = useR2Files()
  const [form, setForm] = useState({
  productName: '',
  retailer: '',
  price: '',
  purchaseDate: '',
  returnDeadline: '',
})
  const upcomingDeadlines = radarItems.filter(
  (item) => item.daysRemaining >= 0
  ).length
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [uploadedReceiptKey, setUploadedReceiptKey] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)

  async function handleExtractReceipt() {
  if (!receiptFile) {
    setMessage('Please select a receipt first.')
    return
  }

  try {
    setIsExtracting(true)
    setMessage('Reading your receipt...')

    // Upload the receipt so the server can access it.
    const existingKey = uploadedReceiptKey

let fileKey = existingKey

if (!fileKey) {
  const uploadResult = await upload(receiptFile, receiptFile.name)

  if (!uploadResult.success || !uploadResult.key) {
    throw new Error('Receipt upload failed.')
  }

  await create({
    fileName: receiptFile.name,
    fileKey: uploadResult.key,
    mimeType: receiptFile.type || 'application/octet-stream',
    fileSize: receiptFile.size,
  })

  fileKey = uploadResult.key
  setUploadedReceiptKey(fileKey)
}

    // Ask the server-side AI action to extract the details.
    const token = await getAuthToken()

    if (!token) {
      throw new Error('Please sign in again before extracting receipt details.')
    }

    const response = await fetch('/api/actions/extract-receipt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fileKey: fileKey,
      }),
    })

    const result: unknown = await response.json()

if (typeof result !== 'object' || result === null || !('success' in result)) {
  throw new Error('Unexpected response from the server.')
}

if (result.success !== true) {
  const errorMessage =
    'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Receipt extraction failed.'

  throw new Error(errorMessage)
}

if (!('data' in result) || typeof result.data !== 'object' || result.data === null) {
  throw new Error('Receipt details were not returned correctly.')
}

const data = result.data as {
  productName?: string
  retailer?: string
  purchaseDate?: string
  price?: number | null
}
    setForm((current) => ({
  ...current,
  productName: data.productName || '',
  retailer: data.retailer || '',
  price: data.price == null ? '' : String(data.price),
  purchaseDate: data.purchaseDate || '',
}))

    setMessage('Receipt details extracted. Please review them before saving.')
  } catch (error) {
    console.error('Receipt extraction failed:', error)
    setMessage(`Extraction failed: ${String(error)}`)
  } finally {
    setIsExtracting(false)
  }
}

  async function handleAddPurchase() {
  if (
    !form.productName.trim() ||
    !form.retailer.trim() ||
    !form.price ||
    !form.purchaseDate
  ) {
    setMessage('Please complete all fields.')
    return
  }

  const price = Number(form.price)

  if (!Number.isFinite(price) || price <= 0) {
    setMessage('Please enter a valid purchase price.')
    return
  }

  try {
    setSaving(true)
    setMessage('')


// Reuse an existing upload, or upload the receipt if needed.
let receiptFileKey = uploadedReceiptKey ?? undefined

if (receiptFile && !receiptFileKey) {
  const result = await upload(receiptFile, receiptFile.name)

  if (!result.success || !result.key) {
    throw new Error('Receipt upload failed.')
  }

  await create({
    fileName: receiptFile.name,
    fileKey: result.key,
    mimeType: receiptFile.type || 'application/octet-stream',
    fileSize: receiptFile.size,
  })

  receiptFileKey = result.key
}

// Save the purchase and its receipt reference
await createConfirmed({
  productName: form.productName.trim(),
  retailer: form.retailer.trim(),
  price,
  purchaseDate: form.purchaseDate,
  returnDeadline: form.returnDeadline || undefined,
  deadlineSource: form.returnDeadline ? 'user' : 'unknown',
  ...(receiptFileKey ? { receiptFileKey } : {}),
})

    setForm({
      productName: '',
      retailer: '',
      price: '',
      purchaseDate: '',
      returnDeadline: '',
    })
    
    setReceiptFile(null)
    setUploadedReceiptKey(null)

    setMessage('Purchase added successfully!')
  } catch (error) {
    console.error('Failed to add purchase:', error)
    setMessage(`Save failed: ${String(error)}`)
  } finally {
    setSaving(false)
  }
}
async function handleDeletePurchase(recordId: string) {
  const confirmed = window.confirm(
    'Are you sure you want to delete this purchase?'
  )

  if (!confirmed) return

  try {
    await removeConfirmed(recordId)
    setMessage('Purchase deleted successfully!')
  } catch (error) {
    console.error('Failed to delete purchase:', error)
    setMessage('Unable to delete purchase.')
  }
}

async function handleViewReceipt(fileKey: string) {
  try {
    const response = await readFile(fileKey)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)

    window.open(url, '_blank')
  } catch (error) {
    console.error('Failed to open receipt:', error)
    setMessage('Unable to open receipt.')
  }
}

async function handleUpdatePurchase(recordId: string) {
  try {
    await putConfirmed(recordId, {
      productName: form.productName.trim(),
      retailer: form.retailer.trim(),
      price: Number(form.price),
      purchaseDate: form.purchaseDate,
      returnDeadline: form.returnDeadline || undefined,
      deadlineSource: form.returnDeadline ? 'user' : 'unknown',
    })

    setEditingId(null)
    setForm({
      productName: '',
      retailer: '',
      price: '',
      purchaseDate: '',
      returnDeadline: '',
    })
    setMessage('Purchase updated successfully!')
  } catch (error) {
    console.error('Failed to update purchase:', error)
    setMessage('Unable to update purchase.')
  }
}
  return (
    <div className="min-h-full bg-[#F7F7F2] px-6 py-10 text-[#24352B]">
      <div className="mx-auto max-w-6xl">

        {/* Welcome section */}
        <header className="mb-10">
          <p className="text-sm font-medium text-[#718174]">
            YOUR PURCHASE COMPANION
          </p>

          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            AfterBuy
          </h1>

          <p className="mt-2 text-[#718174]">
            Keep track of what you buy. Never miss what comes next.
          </p>
        </header>

        {/* Overview cards */}
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[#E5E8DF] bg-white p-6">
            <p className="text-sm text-[#718174]">Purchases tracked</p>
            <p className="mt-3 text-3xl font-semibold">{purchases.length}</p>
          </div>

          <div className="rounded-xl border border-[#E5E8DF] bg-white p-6">
            <p className="text-sm text-[#718174]">Upcoming deadlines</p>
            <p className="mt-3 text-3xl font-semibold">{upcomingDeadlines}</p>
          </div>

          <div className="rounded-xl border border-[#E5E8DF] bg-white p-6 sm:col-span-2 lg:col-span-1">
            <p className="text-sm text-[#718174]">Purchases with Deadlines</p>
            <p className="mt-3 text-3xl font-semibold">{purchasesProtected}</p>
          </div>
        </section>

        {/* Purchase history */}
        {/* Add a purchase */}
<section className="mb-8 rounded-2xl border border-[#E5E8DF] bg-white p-6">
  <h2 className="text-lg font-semibold">Add a Purchase</h2>
  <p className="mt-1 text-sm text-[#718174]">
    Keep a record of something you've bought.
  </p>

  <div className="mt-5 grid gap-4 sm:grid-cols-2">
    <input
      type="text"
      placeholder="Product name"
      value={form.productName}
      onChange={(e) =>
        setForm({ ...form, productName: e.target.value })
      }
      className="rounded-lg border border-[#E5E8DF] p-3"
    />

    <input
      type="text"
      placeholder="Retailer"
      value={form.retailer}
      onChange={(e) =>
        setForm({ ...form, retailer: e.target.value })
      }
      className="rounded-lg border border-[#E5E8DF] p-3"
    />

    <input
      type="number"
      min="0.01"
      step="0.01"
      placeholder="Purchase price ($)"
      value={form.price}
      onChange={(e) =>
        setForm({ ...form, price: e.target.value })
      }
      className="rounded-lg border border-[#E5E8DF] p-3"
    />

<div>
  <label className="mb-1 block text-sm font-medium text-[#24352B]">
    Purchase Date
  </label>
  <input
    type="date"
    value={form.purchaseDate}
    onChange={(e) =>
      setForm({ ...form, purchaseDate: e.target.value })
    }
    className="w-full rounded-lg border border-[#E5E8DF] p-3"
  />
</div>

<div>
  <label className="mb-1 block text-sm font-medium text-[#24352B]">
    Return Deadline (Optional)
  </label>
  <input
    type="date"
    value={form.returnDeadline}
    onChange={(e) =>
      setForm({ ...form, returnDeadline: e.target.value })
    }
    className="w-full rounded-lg border border-[#E5E8DF] p-3"
  />
  <p className="mt-1 text-xs text-[#718174]">
    Enter the last day you can return this purchase, if known.
  </p>
</div>

<div>
  <label className="mb-1 block text-sm font-medium text-[#24352B]">
    Receipt Image (Optional)
  </label>
  <input
    type="file"
    accept="image/jpeg,image/png,image/webp"
    onChange={(e) =>
      setReceiptFile(e.target.files?.[0] ?? null)
    }
    className="w-full rounded-lg border border-[#E5E8DF] p-3"
  />
  <p className="mt-1 text-xs text-[#718174]">
    Upload a JPEG, PNG, or WebP image to extract purchase details.
  </p>
</div>

    <button
      type="button"
      onClick={handleExtractReceipt}
      disabled={!receiptFile || isExtracting}
      className="rounded-lg bg-[#243F32] px-4 py-3 text-white disabled:opacity-50"
    >
      {isExtracting ? 'Reading Receipt...' : 'Extract Receipt Details'}
    </button>
  </div>

  {receiptFile && (
  <p className="mt-3 text-sm text-[#718174]">
    Selected receipt: {receiptFile.name}
  </p>
)}

  <button
    onClick={() => {
      if (editingId) {
        handleUpdatePurchase(editingId)
      } else {
        handleAddPurchase()
      }
    }}
    disabled={saving}
    className="mt-5 rounded-lg bg-[#243F32] px-6 py-3 font-medium text-white disabled:opacity-50"
  >
    {saving
      ? 'Saving...'
      : editingId
        ? 'Save Changes'
        : 'Add Purchase'}
  </button>

  {message && (
    <p className="mt-3 text-sm text-[#718174]">
      {message}
    </p>
  )}
</section>
<section className="mb-8 rounded-2xl bg-[#24352B] p-6 text-white">
  <h2 className="text-xl font-semibold">Regret Radar</h2>
  <p className="mt-1 text-sm text-white/70">
    Purchases that may need your attention.
  </p>

  {radarItems.length === 0 && purchasesWithoutDeadlines.length === 0 ? (
  <p className="mt-4 text-sm text-white/70">
    No purchases to track yet. Add a purchase to get started.
  </p>
) : (
  <>
    {radarItems.length > 0 && (
      <div className="mt-4 space-y-3">
        {radarItems.map((item) => (
          <div
            key={item.recordId}
            className="rounded-xl bg-white/10 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">{item.productName}</h3>
              <span className="text-sm font-semibold">
                ${item.price.toFixed(2)}
              </span>
            </div>

            <p className="mt-1 text-sm text-white/70">
              {item.retailer}
            </p>

            <p
              className={`mt-2 text-sm font-medium ${
                item.daysRemaining < 0
                  ? 'text-red-300'
                  : item.daysRemaining === 0
                    ? 'text-amber-300'
                    : 'text-white'
              }`}
            >
              {item.explanation}
            </p>
          </div>
        ))}
      </div>
    )}

    {purchasesWithoutDeadlines.length > 0 && (
      <div className="mt-6">
        <h3 className="font-semibold text-amber-200">
          Needs a Return Deadline
        </h3>
        <p className="mt-1 text-sm text-white/70">
          These purchases don't have a return deadline recorded.
        </p>

        <div className="mt-3 space-y-2">
          {purchasesWithoutDeadlines.map((purchase) => (
            <div
              key={purchase.recordId}
              className="rounded-xl bg-white/10 p-3"
            >
              <p className="font-medium">
                {purchase.data.productName}
              </p>
              <p className="text-sm text-white/70">
                {purchase.data.retailer}
              </p>
            </div>
          ))}
        </div>
      </div>
    )}
  </>
)}
</section>
        <section className="rounded-2xl border border-[#E5E8DF] bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">My Purchases</h2>
              <p className="mt-1 text-sm text-[#718174]">
                Your purchase history, all in one place.
              </p>
            </div>
          </div>

          {status === 'loading' ? (
  <p className="py-12 text-center text-[#718174]">
    Loading purchases...
  </p>
) : error ? (
  <p className="py-12 text-center text-red-600">
    Unable to load purchases.
  </p>
) : purchases.length === 0 ? (
  <div className="py-12 text-center">
    <h3 className="font-medium">Your purchase list is empty.</h3>
    <p className="mt-2 text-sm text-[#718174]">
      Once you add a purchase, it will appear here.
    </p>
  </div>
) : (
  <div className="mt-6 divide-y divide-[#E5E8DF]">
  {purchases.map((purchase) => (
    <div
      key={purchase.recordId}
      className="flex flex-wrap items-center justify-between gap-4 py-5"
  >
      <div>
        <h3 className="font-medium">
          {purchase.data.productName}
        </h3>

        <p className="mt-1 text-sm text-[#718174]">
          {purchase.data.retailer} · {purchase.data.purchaseDate}
        </p>
      </div>

     <div className="flex items-center gap-3">
  <p className="font-semibold">
    ${purchase.data.price.toFixed(2)}
  </p>
  {purchase.data.receiptFileKey && (
  <button
    onClick={() => handleViewReceipt(purchase.data.receiptFileKey!)}
    className="rounded-lg border border-[#E5E8DF] px-3 py-2 text-sm hover:bg-gray-50"
  >
    View Receipt
  </button>
)}

  <button
    onClick={() => {
      setEditingId(purchase.recordId)
      setForm({
        productName: purchase.data.productName,
        retailer: purchase.data.retailer,
        price: String(purchase.data.price),
        purchaseDate: purchase.data.purchaseDate,
        returnDeadline: purchase.data.returnDeadline ?? '',
      })
    }}
    className="rounded-lg border border-[#E5E8DF] px-3 py-2 text-sm hover:bg-gray-50"
  >
    Edit
  </button>

  <button
    onClick={() => handleDeletePurchase(purchase.recordId)}
    className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
  >
    Delete
  </button>
</div>
    </div>
  ))}
  </div>
)}
        </section>

      </div>
    </div>
  )
}
