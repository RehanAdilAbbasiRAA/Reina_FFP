from user_v3_APIs import *
import asyncio
import gc
import threading
import traceback
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.events import EVENT_JOB_ERROR, EVENT_SCHEDULER_SHUTDOWN, EVENT_JOB_MISSED
from apscheduler.executors.pool import ThreadPoolExecutor as APSThreadPoolExecutor

# Initialize executor with proper max_workers
MAX_WORKERS = 50
executor = APSThreadPoolExecutor(max_workers=MAX_WORKERS)

async def start_scheduler():
    """
    Final fixed version with proper thread pool monitoring
    """
    scheduler = BackgroundScheduler(
        executors={'default': executor},
        job_defaults={
            'misfire_grace_time': 3600,
            'coalesce': False,
            'max_instances': 3
        }
    )
    loop = asyncio.get_running_loop()

    def scheduler_event_listener(event):
        if event.code == EVENT_SCHEDULER_SHUTDOWN:
            print(f"[CRITICAL] 🔴 Scheduler shutdown! Reason: {event}")
        elif event.code == EVENT_JOB_ERROR:
            print(f"[JOB-CRASH] 💥 {event.job_id} failed: {event.exception}")
        elif event.code == EVENT_JOB_MISSED:
            print(f"[JOB-MISSED] ⏰ {event.job_id} missed its scheduled run!")

    scheduler.add_listener(scheduler_event_listener, 
                         EVENT_SCHEDULER_SHUTDOWN | EVENT_JOB_ERROR | EVENT_JOB_MISSED)

    async def run_async_job(job_func):
        """Proper async job execution with thread monitoring"""
        job_name = job_func.__name__
        start_time = datetime.now()
        thread_id = threading.current_thread().ident
        print(f"[JOB-START] 🚀 {job_name} | Thread: {thread_id} | Time: {start_time}")
        
        try:
            # Safe thread monitoring
            active_threads = threading.active_count()
            if active_threads > MAX_WORKERS * 0.8:
                print(f"[THREAD-WARNING] 🟡 High thread usage: {active_threads}/{MAX_WORKERS}")

            await job_func()
            
            duration = (datetime.now() - start_time).total_seconds()
            print(f"[JOB-END] ✅ {job_name} completed in {duration:.2f}s | Thread: {thread_id}")
            
        except asyncio.TimeoutError:
            print(f"[JOB-TIMEOUT] ⏳ {job_name} exceeded time limit! | Thread: {thread_id}")
            print(f"[THREAD-STATE] Active threads: {threading.active_count()}")
            traceback.print_stack()
        except Exception as e:
            print(f"[JOB-ERROR] ❌ {job_name} failed: {type(e).__name__} | Thread: {thread_id}")
            traceback.print_exc()
        finally:
            gc.collect()

    # Schedule jobs
    jobs = [
        (insert_remaining_deals, 'insert_deals', IntervalTrigger(minutes=30)),
        (delete_accounts_exceeding_loss_limit, 'delete_accounts', IntervalTrigger(minutes=5)),
        (upgrade_accounts_based_on_profit, 'upgrade_accounts', IntervalTrigger(minutes=5)),
        (user_update, 'user_update', IntervalTrigger(minutes=10)),
        (return_similar_trades, 'return_similar_trades', IntervalTrigger(minutes=120)),
        (check_time_between_opening_and_closing, 'check_open_close_time', IntervalTrigger(minutes=120)),
    ]

    for job_func, job_id, trigger in jobs:
        scheduler.add_job(lambda j=job_func: asyncio.run_coroutine_threadsafe(run_async_job(j), loop),trigger=trigger,id=job_id,replace_existing=True,max_instances=3)

    def health_check():
        try:
            print(f"""
                    [HEALTH-REPORT] 📊 {datetime.now()}
                    Scheduler: {'✅ RUNNING' if scheduler.running else '❌ STOPPED'}
                    Threads: {threading.active_count()} total (Max: {MAX_WORKERS})
                    Pending Jobs: {len(scheduler.get_jobs())}
                    Next Runs:
                    {chr(10).join(f'    • {j.id}: {j.next_run_time.strftime("%H:%M:%S")}' for j in scheduler.get_jobs())}""")
        except Exception as e:
            print(f"[HEALTH-ERROR] ❗ Monitoring failed: {str(e)}")

    scheduler.add_job(health_check,IntervalTrigger(minutes=5),id='health_check',misfire_grace_time=60,max_instances=1)

    scheduler.start()
    print(f"[INIT] Scheduler started with {len(jobs)} jobs at {datetime.now()}")

async def start_scheduler_on_startup():
    loop = asyncio.get_running_loop()
    loop.create_task(start_scheduler())
    print("[SYSTEM] Scheduler initialized with monitoring")