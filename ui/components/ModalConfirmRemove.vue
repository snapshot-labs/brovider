<script setup>
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  }
});
const emit = defineEmits(['confirm', 'update:modelValue']);

function setIsOpen(value) {
  emit('update:modelValue', value);
}

function confirmRemoveNode() {
  emit('confirm', props.modelValue);
  setIsOpen(false);
}
</script>

<template>
  <HeadlessTransitionRoot appear :show="modelValue" as="template">
    <HeadlessDialog as="div" class="relative z-10" @close="setIsOpen(false)">
      <HeadlessTransitionChild
        as="template"
        enter="duration-300 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black bg-opacity-25" />
      </HeadlessTransitionChild>

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-4 text-center">
          <HeadlessTransitionChild
            as="template"
            enter="duration-300 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-200 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <HeadlessDialogPanel
              class="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all"
            >
              <HeadlessDialogTitle
                as="h3"
                class="text-lg font-medium leading-6 text-gray-900 text-center"
              >
                Node removal
              </HeadlessDialogTitle>
              <div class="my-6">
                <p class="text-sm text-gray-500 text-center">
                  Are you sure you want to remove this node? All data will be lost.
                </p>
              </div>

              <div class="mt-4 flex w-full justify-around">
                <button
                  type="button"
                  class="inline-flex justify-center rounded-md border border-transparent bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  @click="confirmRemoveNode"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  class="inline-flex justify-center rounded-md border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
                  @click="setIsOpen(false)"
                >
                  Cancel
                </button>
              </div>
            </HeadlessDialogPanel>
          </HeadlessTransitionChild>
        </div>
      </div>
    </HeadlessDialog>
  </HeadlessTransitionRoot>
</template>
