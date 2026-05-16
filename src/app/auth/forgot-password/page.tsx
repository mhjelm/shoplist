'use client'

import { useState } from 'react'
import Link from 'next/link'
import { requestPasswordReset } from '../actions'

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setLoading(true)
    const result = await requestPasswordReset(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow p-8 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Reset password</h1>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              If an account with that email exists, we&apos;ve sent a link to reset your password. Check your inbox.
            </p>
            <Link
              href="/auth/login"
              className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2 text-sm transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>
            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-2 text-sm transition-colors"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              <Link href="/auth/login" className="text-blue-600 dark:text-blue-400 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
