<script setup>
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  node: {
    type: Object
  }
});
const emit = defineEmits(['update:modelValue']);

const detailsList = computed(() => {
  return Object.entries(props.node).map(([key, value]) => {
    return {
      key,
      value
    };
  });
});

function setIsOpen(value) {
  emit('update:modelValue', value);
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
                Node details
              </HeadlessDialogTitle>

              <div class="my-6">
                <div class="props-list text-sm text-gray-500 text-center">
                  <div
                    v-for="(listItem, key) in detailsList"
                    :key="key"
                    class="flex justify-between py-2 border-t last:border-b"
                  >
                    <div class="font-semibold">{{ listItem.key }}</div>
                    <div>{{ listItem.value }}</div>
                  </div>
                </div>
              </div>

              <div class="mt-4 flex w-full justify-center">
                <button
                  type="button"
                  class="inline-flex justify-center rounded-md border border-transparent bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
                  @click="setIsOpen(false)"
                >
                  Done
                </button>
              </div>
            </HeadlessDialogPanel>
          </HeadlessTransitionChild>
        </div>
      </div>
    </HeadlessDialog>
  </HeadlessTransitionRoot>
</template>
