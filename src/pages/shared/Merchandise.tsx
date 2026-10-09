import { supabase } from '../../lib/supabase'
import { must, useLoad } from '../../lib/useLoad'
import { useCurrentEvent } from '../../lib/useEvent'
import { Banner, ButtonA, Skeleton } from '../../components/ui'
import './merch.css'

interface Item {
  id: string
  name: string
  credit_cost: number
  image_path: string | null
}

function ImageGlyph() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#5166D6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 8" />
    </svg>
  )
}

/** Instructor (and admin) Merchandise page: the catalog only, no points. */
export function StaffMerchandise() {
  const ev = useCurrentEvent()
  const eventId = ev.data?.event?.id ?? null
  const s = ev.data?.settings ?? null
  const { data } = useLoad(async () => {
    if (!eventId) return null
    return must(await supabase.from('merch_items').select('id, name, credit_cost, image_path').eq('event_id', eventId).eq('visible', true).order('sort').order('credit_cost')) as Item[]
  }, [eventId])

  const rec = s?.merch_recommendation_form_url
  return (
    <>
      <Banner title="Merch!" sub={ev.data?.event ? `Sneak Preview of ${ev.data.event.year} Merch!` : undefined} plain />
      <main className="page merch">
        {!ev.data && <Skeleton height={240} />}
        {ev.data && !s?.merch_ready && (
          <section className="soon">
            <span className="soon__c1" aria-hidden="true" />
            <span className="soon__c2" aria-hidden="true" />
            <h2>Coming Soon</h2>
            <p>
              ScioCamp merch is on the way.
              <br />
              We're working on something great.
            </p>
            {rec && (
              <div className="soon__rec">
                <span>Have a recommendation?</span>
                <ButtonA href={rec} target="_blank" rel="noreferrer" className="btn--teal">
                  Merch Recommendation Form
                </ButtonA>
              </div>
            )}
          </section>
        )}
        {s?.merch_ready && (
          <>
            <div className="merchbar">
              <span>All Instructors get 1 Item automatically, extras on a case-by-case basis</span>
              {s.merch_instructor_form_url && (
                <ButtonA href={s.merch_instructor_form_url} target="_blank" rel="noreferrer">
                  Open Google Form
                </ButtonA>
              )}
            </div>
            <div className="merchgrid">
              {!data && <Skeleton height={240} />}
              {data?.map((it) => (
                <article key={it.id} className="merchitem">
                  <div className="merchitem__img">
                    <ImageGlyph />
                  </div>
                  <h2 className="merchitem__name">{it.name}</h2>
                </article>
              ))}
            </div>
            {rec && (
              <div className="merchbar merchbar--teal">
                <span>If you have ideas for merch, please submit them here!</span>
                <ButtonA href={rec} target="_blank" rel="noreferrer" className="btn--teal">
                  Merch Recommendation Form
                </ButtonA>
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
